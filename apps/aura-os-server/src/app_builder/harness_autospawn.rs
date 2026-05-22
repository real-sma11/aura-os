use super::*;

/// Resolve the directory containing the aura-harness source.
///
/// Checks `AURA_HARNESS_DIR` env var first, then common sibling paths
/// relative to the workspace root (`../../aura-harness` when running from
/// `apps/aura-os-server`, and `../aura-harness` from the workspace root).
pub(super) fn find_harness_dir() -> Option<PathBuf> {
    if let Some(dir) = env_opt("AURA_HARNESS_DIR") {
        let p = PathBuf::from(dir);
        if p.join("Cargo.toml").exists() {
            return Some(p);
        }
    }
    let candidates = [
        PathBuf::from("../aura-harness"),
        PathBuf::from("../../aura-harness"),
    ];
    candidates
        .into_iter()
        .find(|p| p.join("Cargo.toml").exists())
}

/// Parse host:port from a URL like `http://127.0.0.1:8080`.
pub(super) fn parse_host_port(url: &str) -> Option<String> {
    url.strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .map(|s| s.trim_end_matches('/').to_string())
}

/// Try to auto-spawn the local aura-harness process if nothing is listening.
///
/// Spawns the child process and polls for readiness in a background thread
/// so it never blocks the caller.
pub(super) fn maybe_spawn_local_harness() {
    if std::env::var("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        info!("Local harness autospawn disabled by env");
        return;
    }

    let harness_url = local_harness_base_url();

    let Some(host_port) = parse_host_port(&harness_url) else {
        return;
    };

    let addr: std::net::SocketAddr = host_port
        .parse()
        .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], 8080)));

    if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_ok() {
        info!("Local harness already running at {harness_url}");
        return;
    }

    let Some(harness_dir) = find_harness_dir() else {
        warn!(
            "Local harness not running at {harness_url} and aura-harness directory not found. \
             Set AURA_HARNESS_DIR or start the harness manually."
        );
        return;
    };

    info!(
        dir = %harness_dir.display(),
        url = %harness_url,
        "Local harness not running — spawning from source"
    );

    let mut cmd = std::process::Command::new("cargo");
    cmd.args(["run", "--release", "--", "run", "--ui", "none"])
        .current_dir(&harness_dir)
        .env("BIND_ADDR", &host_port)
        .env("BIND_PORT", addr.port().to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // Phase 6 of the robust-concurrent-agent-infra plan: forward the
    // configured WS-slot cap to the autospawned harness child so both
    // ends agree on the limit. The harness binary is expected to read
    // `AURA_HARNESS_WS_SLOTS` itself to size its semaphore — if the
    // version currently in use does not, the env var still propagates
    // through `.env` overlays and config files inside the harness dir
    // unchanged, and the server-side `ApiError::harness_capacity_exhausted`
    // message keeps reflecting the configured value (so operators see
    // the intended cap even when the upstream binary still uses its
    // own default). Track that follow-up on the harness side; this
    // crate does not own the upstream source.
    if let Ok(slots) = std::env::var(super::HARNESS_WS_SLOTS_ENV) {
        if !slots.trim().is_empty() {
            cmd.env(super::HARNESS_WS_SLOTS_ENV, slots);
        }
    }

    // Load the harness's own .env so the child gets its configured values
    // (service URLs, etc.) regardless of what the
    // parent process has in its environment.
    let harness_env_file = harness_dir.join(".env");
    if harness_env_file.exists() {
        if let Ok(contents) = std::fs::read_to_string(&harness_env_file) {
            for (key, val) in parse_env_file(&contents) {
                cmd.env(key, val);
            }
        }
    }

    // After the harness's `.env` has populated the child env, override the
    // service URLs the harness uses to call back into our control plane
    // with values derived from THIS server's own configuration. The
    // harness's `.env` ships with production defaults (e.g.
    // `AURA_OS_SERVER_URL=http://127.0.0.1:3100`,
    // `AURA_STORAGE_URL=https://aura-storage.onrender.com`); without this
    // step, every `domain_tools::create_spec` POST that the harness's
    // `HttpDomainApi` issues lands on a dead port (or worse, the public
    // production cluster) — silently logged as `is_error=false` because
    // the failure is wrapped in `domain_ok({"ok":false,...})` — and the
    // LLM session loops trying to "fix" the missing specs until
    // `max_turns` cuts it off.
    //
    // Repro: this manifested as preflight `list_specs` returning zero
    // specs after an apparently-successful 117-second `spec_stream` run
    // when `AURA_SERVER_PORT=3190` (any port other than the harness
    // `.env`'s pinned `3100`).
    for (key, value) in derive_harness_url_overrides(env_var_or_none) {
        cmd.env(key, value);
    }

    match cmd.spawn() {
        Ok(mut child) => {
            info!(
                pid = child.id(),
                "aura-harness child process spawned (building in background)"
            );

            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    if let Ok(Some(status)) = child.try_wait() {
                        let _ = status;
                        break;
                    }
                    if std::time::Instant::now() > deadline {
                        tracing::warn!("Timed out waiting for local harness to become ready");
                        break;
                    }
                    if std::net::TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(200),
                    )
                    .is_ok()
                    {
                        tracing::info!("Local harness is ready at {harness_url}");
                        break;
                    }
                }
            });
        }
        Err(e) => {
            warn!(error = %e, "Failed to spawn aura-harness child process");
        }
    }
}

pub(crate) fn ensure_local_harness_running() {
    let preflight = preflight_local_harness_config(env_var_or_none);
    log_local_harness_resolution(&preflight);
    if let LocalHarnessPreflight::Misconfigured { message, .. } = &preflight {
        tracing::error!("{message}");
    }
    maybe_spawn_local_harness();
}

/// Stamp a single boot-log line describing where the local harness
/// base URL came from. Operators and on-call rely on this to answer
/// "is chat actually wired up?" without grepping source — especially
/// after the [`HarnessUrlSource::SwarmBaseUrl`] fallback was added,
/// which makes a previously-fatal misconfig (LOCAL_HARNESS_URL
/// unset, SWARM_BASE_URL set) silently work.
fn log_local_harness_resolution(preflight: &LocalHarnessPreflight) {
    match preflight {
        LocalHarnessPreflight::Ok { url, source } => {
            info!(
                resolved_url = %url,
                source = source.as_str(),
                "Local harness base URL resolved"
            );
        }
        LocalHarnessPreflight::Misconfigured {
            url,
            source,
            message: _,
        } => {
            warn!(
                resolved_url = %url,
                source = source.as_str(),
                "Local harness base URL resolved to loopback / default — chat will fail unless autospawn brings up a sibling harness"
            );
        }
    }
}

/// Outcome of [`preflight_local_harness_config`].
///
/// `Ok` carries the resolved URL + source so the caller can stamp a
/// single `info!` line at boot without re-reading the env. The
/// `Misconfigured` variant carries the same plus a pre-rendered
/// operator-facing `message` because the call site's job is just
/// "log it"; we don't want every boot-time call site duplicating the
/// remediation prose.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum LocalHarnessPreflight {
    Ok {
        url: String,
        source: HarnessUrlSource,
    },
    Misconfigured {
        url: String,
        source: HarnessUrlSource,
        message: String,
    },
}

/// Detect the "autospawn disabled + no remote harness reachable"
/// combo that produced the production chat outage. When autospawn
/// is on, the existing `maybe_spawn_local_harness` path either
/// succeeds or loudly logs "aura-harness directory not found" /
/// "Failed to spawn", so this preflight stays in the `Ok` arm and
/// lets that flow run.
///
/// When autospawn is off (the production default — autospawn is a
/// developer-only convenience that requires a sibling source
/// checkout), the resolved URL is the only thing standing between
/// the server and a wedged chat surface. `LOCAL_HARNESS_URL` and
/// `SWARM_BASE_URL` resolve through
/// [`resolve_local_harness_base_url`] in `aura-os-harness` (single
/// source of truth), so prod that already has `SWARM_BASE_URL`
/// pointing at the deployed aura-node Just Works without a second
/// env var. Only the `LocalhostDefault` source — which means both
/// env vars are unset / blank — is treated as a misconfig in the
/// "autospawn disabled" branch.
///
/// `read` is parameterised so the unit test can stub the env
/// without touching `std::env::set_var`, matching the same pattern
/// `derive_harness_url_overrides` already uses.
pub(super) fn preflight_local_harness_config<F>(read: F) -> LocalHarnessPreflight
where
    F: Fn(&str) -> Option<String>,
{
    let resolved = resolve_local_harness_base_url(&read);
    let autospawn_disabled = read("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let url_is_unreachable_for_clients = matches!(resolved.source, HarnessUrlSource::LocalhostDefault)
        || is_loopback_url(&resolved.url);

    if autospawn_disabled && url_is_unreachable_for_clients {
        let message = format!(
            "production misconfiguration: autospawn is disabled \
             (AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN=true) and the \
             resolved harness URL is loopback / unset \
             (resolved=`{}`, source={}) — chat will fail with \
             `local harness websocket connect failed`. Set \
             SWARM_BASE_URL or LOCAL_HARNESS_URL on the Render \
             dashboard to the deployed aura-node service URL.",
            resolved.url,
            resolved.source.as_str()
        );
        return LocalHarnessPreflight::Misconfigured {
            url: resolved.url,
            source: resolved.source,
            message,
        };
    }

    LocalHarnessPreflight::Ok {
        url: resolved.url,
        source: resolved.source,
    }
}

/// True when `url`'s host component is a loopback or unroutable
/// address (`127.0.0.1`, `::1`, `0.0.0.0`, `localhost`). Used by
/// the preflight to decide whether `LOCAL_HARNESS_URL` is a real
/// remote harness or a development default that leaked into a
/// production env. `0.0.0.0` is included because it's a common
/// "bind on all interfaces" value that's never reachable as a
/// client target.
fn is_loopback_url(url: &str) -> bool {
    let after_scheme = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .or_else(|| url.strip_prefix("ws://"))
        .or_else(|| url.strip_prefix("wss://"))
        .unwrap_or(url);
    let host = after_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(after_scheme);
    let host = host.trim_start_matches('[').trim_end_matches(']');
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1"
    )
}

/// Parse a dotenv-style file body into `(key, value)` pairs.
///
/// Skips blank lines and `#` comment lines, trims whitespace around the
/// key/value, and drops entries whose value is empty after trimming.
/// Quoting is intentionally NOT honoured because the harness's `.env` is
/// hand-edited free-form and the existing inline parser this replaces
/// behaved identically — keeping behaviour bit-identical avoids a
/// stealth change to which env vars survive into the spawned child.
pub(super) fn parse_env_file(contents: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, val)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let val = val.trim();
        if key.is_empty() || val.is_empty() {
            continue;
        }
        out.push((key.to_string(), val.to_string()));
    }
    out
}

/// Read an env var into a non-empty trimmed `String`, returning `None`
/// for unset / empty / whitespace-only values. Lifted to a free fn so
/// `derive_harness_url_overrides` can be unit-tested without touching
/// process state.
pub(super) fn env_var_or_none(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Derive the service URLs the autospawned harness child should use to
/// call back into our control plane.
///
/// Returns a vector of `(harness_env_key, value)` pairs that the caller
/// applies to the child `Command` AFTER loading the harness's own `.env`,
/// so the parent's view wins over any stale defaults baked into that
/// file. Each entry is only emitted when we have a confident value:
///
/// - `AURA_OS_SERVER_URL`: always emitted, derived from
///   [`aura_os_integrations::control_plane_api_base_url`] which is the
///   single source of truth for "URL this server is reachable at" (it
///   already honours `AURA_SERVER_BASE_URL` / `VITE_API_URL` /
///   `AURA_SERVER_HOST` / `AURA_SERVER_PORT`). The harness's
///   `HttpDomainApi` keys spec / task / project / log writes off this
///   URL — getting it wrong is what produced the
///   `list_specs` returned 0 specs preflight regression.
/// - `AURA_STORAGE_URL`, `AURA_NETWORK_URL`: forwarded only when the
///   parent has them set explicitly (the local-stack `aura-os.env` does;
///   the desktop-only path leaves them unset and lets the harness's
///   `.env` defaults stand). The harness's `HttpDomainApi` falls back
///   to these for spec writes when `AURA_OS_SERVER_URL` is unset and
///   for several read paths regardless.
/// - `ORBIT_URL`: forwarded from the parent's `ORBIT_BASE_URL` (the
///   variable `aura-os-server` itself reads — the harness reads
///   `ORBIT_URL`, so the names must be translated explicitly).
///
/// `read` is parameterised so tests can stub the env without poking at
/// global process state.
pub(super) fn derive_harness_url_overrides<F>(read: F) -> Vec<(&'static str, String)>
where
    F: Fn(&str) -> Option<String>,
{
    let mut out: Vec<(&'static str, String)> = Vec::new();

    // Always set AURA_OS_SERVER_URL — the harness's `.env` ships with a
    // hard-coded `:3100` default that breaks any operator who pins a
    // different `AURA_SERVER_PORT`.
    out.push((
        "AURA_OS_SERVER_URL",
        aura_os_integrations::control_plane_api_base_url(),
    ));

    // Forward the storage/network/orbit URLs only when the parent has
    // them set; otherwise leave the harness's `.env` defaults alone.
    for (parent_key, child_key) in [
        ("AURA_STORAGE_URL", "AURA_STORAGE_URL"),
        ("AURA_NETWORK_URL", "AURA_NETWORK_URL"),
        ("ORBIT_BASE_URL", "ORBIT_URL"),
    ] {
        if let Some(value) = read(parent_key) {
            out.push((child_key, value));
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reader_from<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key: &str| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| (*v).to_string())
        }
    }

    #[test]
    fn parse_env_file_skips_comments_and_blanks() {
        let body = "
# top comment
AURA_OS_SERVER_URL=http://127.0.0.1:3100

   # leading-whitespace comment
ORBIT_URL=https://orbit-sfvu.onrender.com
EMPTY=

NO_EQUALS_LINE
   AURA_STORAGE_URL  =   https://aura-storage.onrender.com   
";

        let parsed = parse_env_file(body);

        assert_eq!(
            parsed,
            vec![
                (
                    "AURA_OS_SERVER_URL".to_string(),
                    "http://127.0.0.1:3100".to_string()
                ),
                (
                    "ORBIT_URL".to_string(),
                    "https://orbit-sfvu.onrender.com".to_string()
                ),
                (
                    "AURA_STORAGE_URL".to_string(),
                    "https://aura-storage.onrender.com".to_string()
                ),
            ]
        );
    }

    #[test]
    fn derive_harness_url_overrides_always_sets_aura_os_server_url() {
        // Empty parent env: AURA_OS_SERVER_URL still gets stamped from
        // control_plane_api_base_url() so the harness's stale `.env`
        // value never reaches the child.
        let read = reader_from(&[]);

        let pairs = derive_harness_url_overrides(read);

        assert!(
            pairs.iter().any(|(k, _)| *k == "AURA_OS_SERVER_URL"),
            "expected AURA_OS_SERVER_URL to always be present in the override set, got {pairs:?}"
        );
        // No spurious storage/network/orbit overrides when the parent
        // has nothing to forward.
        for skipped in ["AURA_STORAGE_URL", "AURA_NETWORK_URL", "ORBIT_URL"] {
            assert!(
                !pairs.iter().any(|(k, _)| *k == skipped),
                "expected {skipped} to be omitted when parent env is empty, got {pairs:?}"
            );
        }
    }

    #[test]
    fn derive_harness_url_overrides_forwards_storage_network_and_orbit() {
        let read = reader_from(&[
            ("AURA_STORAGE_URL", "http://127.0.0.1:3402"),
            ("AURA_NETWORK_URL", "http://127.0.0.1:3401"),
            ("ORBIT_BASE_URL", "http://127.0.0.1:3403"),
        ]);

        let pairs = derive_harness_url_overrides(read);

        let lookup: std::collections::HashMap<_, _> = pairs.into_iter().collect();
        assert_eq!(
            lookup.get("AURA_STORAGE_URL").map(String::as_str),
            Some("http://127.0.0.1:3402"),
        );
        assert_eq!(
            lookup.get("AURA_NETWORK_URL").map(String::as_str),
            Some("http://127.0.0.1:3401"),
        );
        // The parent reads ORBIT_BASE_URL but the harness reads
        // ORBIT_URL; the override layer must translate the name.
        assert_eq!(
            lookup.get("ORBIT_URL").map(String::as_str),
            Some("http://127.0.0.1:3403"),
        );
        assert!(
            lookup.contains_key("AURA_OS_SERVER_URL"),
            "AURA_OS_SERVER_URL must remain in the override set even when other URLs are also set"
        );
    }

    #[test]
    fn preflight_ok_when_autospawn_enabled_regardless_of_url() {
        // Autospawn-on is the developer path: `maybe_spawn_local_harness`
        // either succeeds or logs its own "directory not found" /
        // "spawn failed" line. The preflight must stay in the Ok arm
        // so we don't double-log a confusing "production
        // misconfiguration" message in dev shells.
        let outcome = preflight_local_harness_config(reader_from(&[]));
        assert!(
            matches!(outcome, LocalHarnessPreflight::Ok { .. }),
            "expected Ok with autospawn on (default) and no env, got {outcome:?}"
        );

        let outcome = preflight_local_harness_config(reader_from(&[(
            "AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN",
            "false",
        )]));
        assert!(
            matches!(outcome, LocalHarnessPreflight::Ok { .. }),
            "expected Ok with autospawn explicitly off, got {outcome:?}"
        );

        // Even with a loopback URL, autospawn-on means the server can
        // recover. The preflight only fires when autospawn is the
        // explicit no-op it is on Render.
        let outcome = preflight_local_harness_config(reader_from(&[(
            "LOCAL_HARNESS_URL",
            "http://localhost:8080",
        )]));
        assert!(
            matches!(outcome, LocalHarnessPreflight::Ok { .. }),
            "expected Ok with autospawn on + dev-default URL, got {outcome:?}"
        );
    }

    /// Production unblock: when `LOCAL_HARNESS_URL` is unset but
    /// `SWARM_BASE_URL` is set to the deployed aura-node service,
    /// the resolution helper falls back to `SWARM_BASE_URL` and the
    /// preflight stays silent. This is the exact path that makes
    /// aura.ai chat start working without any Render dashboard
    /// changes.
    #[test]
    fn preflight_ok_when_swarm_base_url_provides_remote_harness() {
        let read = reader_from(&[
            ("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN", "true"),
            ("SWARM_BASE_URL", "https://aura-node-prod.onrender.com"),
        ]);
        let outcome = preflight_local_harness_config(read);
        let LocalHarnessPreflight::Ok { url, source } = outcome else {
            panic!("expected Ok via SWARM_BASE_URL fallback, got {outcome:?}");
        };
        assert_eq!(url, "https://aura-node-prod.onrender.com");
        assert_eq!(
            source,
            HarnessUrlSource::SwarmBaseUrl,
            "boot log must attribute the resolution to SWARM_BASE_URL so operators see the fallback"
        );
    }

    #[test]
    fn preflight_misconfigured_when_autospawn_off_and_both_urls_unset() {
        let read = reader_from(&[("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN", "true")]);
        let outcome = preflight_local_harness_config(read);
        let LocalHarnessPreflight::Misconfigured {
            message, source, ..
        } = outcome
        else {
            panic!("expected misconfigured outcome, got {outcome:?}");
        };
        assert_eq!(
            source,
            HarnessUrlSource::LocalhostDefault,
            "with both env vars unset the resolved source is the localhost default"
        );
        assert!(
            message.contains("SWARM_BASE_URL"),
            "preflight message must point operators at SWARM_BASE_URL, got: {message}"
        );
        assert!(
            message.contains("LOCAL_HARNESS_URL"),
            "preflight message must also name LOCAL_HARNESS_URL, got: {message}"
        );
    }

    #[test]
    fn preflight_misconfigured_for_loopback_urls() {
        // A prod operator that sets either env var to a loopback
        // value by accident reaches the same broken state as leaving
        // them unset (the resolution helper trusts non-empty values).
        // Make sure the preflight catches both shapes — host-by-name
        // and host-by-IP — across both env vars.
        for (var, url) in [
            ("LOCAL_HARNESS_URL", "http://localhost:8080"),
            ("LOCAL_HARNESS_URL", "http://127.0.0.1:8080"),
            ("LOCAL_HARNESS_URL", "http://0.0.0.0:8080"),
            ("LOCAL_HARNESS_URL", "https://LOCALHOST:8080"),
            ("LOCAL_HARNESS_URL", "ws://localhost:8081/stream"),
            ("LOCAL_HARNESS_URL", "wss://[::1]:8080/stream"),
            ("SWARM_BASE_URL", "http://localhost:8080"),
            ("SWARM_BASE_URL", "http://127.0.0.1:8080"),
        ] {
            let pairs = [
                ("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN", "1"),
                (var, url),
            ];
            let read = reader_from(&pairs);
            let outcome = preflight_local_harness_config(read);
            let LocalHarnessPreflight::Misconfigured {
                message,
                url: resolved_url,
                ..
            } = outcome
            else {
                panic!("expected misconfigured outcome for {var}={url}, got {outcome:?}");
            };
            assert_eq!(
                resolved_url, url,
                "resolved URL must match the env var that produced it"
            );
            assert!(
                message.contains(url),
                "preflight must echo the offending URL `{url}`, got: {message}"
            );
        }
    }

    #[test]
    fn preflight_ok_when_autospawn_off_but_remote_url_set() {
        // The intended production state: autospawn off, LOCAL_HARNESS_URL
        // pointing at the deployed aura-node Render service.
        let read = reader_from(&[
            ("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN", "true"),
            ("LOCAL_HARNESS_URL", "https://aura-node-prod.onrender.com"),
        ]);
        let outcome = preflight_local_harness_config(read);
        let LocalHarnessPreflight::Ok { url, source } = outcome else {
            panic!("expected Ok via explicit LOCAL_HARNESS_URL, got {outcome:?}");
        };
        assert_eq!(url, "https://aura-node-prod.onrender.com");
        assert_eq!(source, HarnessUrlSource::LocalHarnessUrl);
    }

    #[test]
    fn preflight_explicit_local_url_wins_over_swarm_when_both_set() {
        // When operators set both — e.g. they want chat sessions on a
        // dedicated harness that's separate from the swarm gateway —
        // LOCAL_HARNESS_URL wins. Important for upcoming setups where
        // the two upstreams legitimately diverge.
        let read = reader_from(&[
            ("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN", "true"),
            ("LOCAL_HARNESS_URL", "https://harness.example.com"),
            ("SWARM_BASE_URL", "https://swarm.example.com"),
        ]);
        let outcome = preflight_local_harness_config(read);
        let LocalHarnessPreflight::Ok { url, source } = outcome else {
            panic!("expected Ok with explicit LOCAL_HARNESS_URL, got {outcome:?}");
        };
        assert_eq!(url, "https://harness.example.com");
        assert_eq!(source, HarnessUrlSource::LocalHarnessUrl);
    }

    #[test]
    fn derive_harness_url_overrides_skips_unset_individual_vars() {
        // Parent has only AURA_STORAGE_URL set — AURA_NETWORK_URL and
        // ORBIT_BASE_URL must NOT be forwarded as empty strings, or the
        // harness's `.env` defaults would be silently clobbered.
        let read = reader_from(&[("AURA_STORAGE_URL", "http://127.0.0.1:3402")]);

        let pairs = derive_harness_url_overrides(read);
        let lookup: std::collections::HashMap<_, _> = pairs.into_iter().collect();

        assert_eq!(
            lookup.get("AURA_STORAGE_URL").map(String::as_str),
            Some("http://127.0.0.1:3402"),
        );
        assert!(
            !lookup.contains_key("AURA_NETWORK_URL"),
            "must not forward AURA_NETWORK_URL when parent has it unset",
        );
        assert!(
            !lookup.contains_key("ORBIT_URL"),
            "must not forward ORBIT_URL when parent has ORBIT_BASE_URL unset",
        );
    }
}
