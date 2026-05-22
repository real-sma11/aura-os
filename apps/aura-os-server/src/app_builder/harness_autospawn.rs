use super::*;

/// Platform-specific filename of the bundled `aura-node` sidecar
/// binary that this crate's autospawn looks for. Mirrors
/// [`crate::harness::binary::harness_binary_name`] in
/// `apps/aura-os-desktop` so a single Render build artefact can be
/// dropped into either tree.
pub(super) fn harness_binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "aura-node.exe"
    } else {
        "aura-node"
    }
}

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

/// Locate the precompiled `aura-node` sidecar binary that the Render
/// build is expected to drop alongside `aura-os-server`.
///
/// Resolution order, first hit wins:
///
/// 1. `AURA_HARNESS_BIN` env var pointing at an explicit absolute or
///    relative path. This is the supported override for operators who
///    stage the binary outside the conventional locations.
/// 2. A sibling `aura-harness` checkout's release artefact at
///    `<sibling>/target/release/aura-node`. This matches the Render
///    build command, which clones `aura-harness` next to the
///    `aura-os` workspace and runs `cargo build --release` inside it.
/// 3. Common in-tree fallbacks (`./target/release/aura-node`,
///    `./aura-node` next to the running binary). These exist so a
///    developer can drop a hand-built binary into the workspace and
///    exercise the production-shape spawn path locally without
///    setting any env vars.
///
/// Returns `None` when no candidate exists. The caller falls through
/// to [`spawn_local_harness_from_source`] (the dev-only `cargo run`
/// path) so behaviour on a fresh dev box stays unchanged.
pub(super) fn resolve_harness_binary_path() -> Option<PathBuf> {
    let binary_name = harness_binary_filename();

    if let Some(explicit) = env_opt("AURA_HARNESS_BIN") {
        let p = PathBuf::from(&explicit);
        if p.is_file() {
            return Some(p);
        }
        warn!(
            path = %p.display(),
            "AURA_HARNESS_BIN configured but the file does not exist"
        );
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(sibling) = find_harness_dir() {
        candidates.push(sibling.join("target/release").join(binary_name));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(binary_name));
            candidates.push(exe_dir.join("sidecar").join(binary_name));
        }
    }

    candidates.push(PathBuf::from("target/release").join(binary_name));
    candidates.push(PathBuf::from("./").join(binary_name));

    candidates.into_iter().find(|p| p.is_file())
}

/// Parse host:port from a URL like `http://127.0.0.1:8080`.
pub(super) fn parse_host_port(url: &str) -> Option<String> {
    url.strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .map(|s| s.trim_end_matches('/').to_string())
}

/// Bind URL the autospawned sidecar should listen on.
///
/// Operators can override with `LOCAL_HARNESS_URL` (only honoured when
/// the host resolves to a local bind); otherwise the channel-specific
/// sidecar port from [`aura_os_core::Channel::preferred_sidecar_port`]
/// is used so the sidecar lands on the same port the desktop sidecar
/// uses, and `aura-node` instances belonging to different channels can
/// coexist on a shared host.
fn sidecar_bind_url() -> String {
    if let Some(explicit) = env_opt("LOCAL_HARNESS_URL") {
        return explicit.trim_end_matches('/').to_string();
    }
    format!(
        "http://127.0.0.1:{}",
        aura_os_core::Channel::current().preferred_sidecar_port()
    )
}

/// Try to auto-spawn the local aura-harness process if nothing is listening.
///
/// Two paths are attempted in order:
///
/// 1. **Bundled-binary spawn** ([`try_spawn_harness_binary`]). Mirrors
///    `apps/aura-os-desktop/src/harness/sidecar.rs` — locate a
///    precompiled `aura-node` artefact (via `AURA_HARNESS_BIN` or the
///    standard candidate paths), spawn it as a child process, and
///    stamp `LOCAL_HARNESS_URL` so the rest of the server connects to
///    it. This is the production path on Render: the build command
///    clones `aura-harness` and `cargo build --release`s `aura-node`
///    so [`resolve_harness_binary_path`] finds it.
///
/// 2. **Source-build spawn** ([`spawn_local_harness_from_source`]). The
///    legacy developer-only flow: find a sibling `aura-harness`
///    checkout and `cargo run --release` it. Slow and depends on a
///    Rust toolchain at runtime, so it never runs in production.
///
/// Both paths poll for readiness in a background thread so this
/// function never blocks the caller.
pub(super) fn maybe_spawn_local_harness() {
    if std::env::var("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        info!("Local harness autospawn disabled by env");
        return;
    }

    if try_spawn_harness_binary() {
        return;
    }

    spawn_local_harness_from_source();
}

/// Production-shape spawn path: launch a precompiled `aura-node`
/// child process and stamp `LOCAL_HARNESS_URL` to its bound URL.
///
/// Returns `true` when this function decided to "handle" the
/// autospawn — either because a sidecar is already listening at the
/// chosen URL or because we successfully launched a new child.
/// Returns `false` to mean "no binary was found, fall through to the
/// developer source-build path"; warnings about a misconfigured
/// `AURA_HARNESS_BIN` are logged inside [`resolve_harness_binary_path`]
/// so the caller doesn't have to reason about the failure modes.
fn try_spawn_harness_binary() -> bool {
    let Some(binary_path) = resolve_harness_binary_path() else {
        return false;
    };

    let harness_url = sidecar_bind_url();
    let Some(host_port) = parse_host_port(&harness_url) else {
        warn!(url = %harness_url, "invalid LOCAL_HARNESS_URL for sidecar launch");
        return false;
    };
    let Ok(addr) = host_port.parse::<std::net::SocketAddr>() else {
        warn!(
            host_port = %host_port,
            "non-numeric host:port for sidecar launch; skipping bundled-binary path"
        );
        return false;
    };

    // Probe first: a previous invocation in the same dyno may have
    // already started the sidecar, or an external operator may be
    // running aura-node by hand for debugging. Don't double-spawn.
    if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_ok() {
        info!(url = %harness_url, "Local harness sidecar already running");
        std::env::set_var("LOCAL_HARNESS_URL", &harness_url);
        return true;
    }

    info!(
        binary = %binary_path.display(),
        url = %harness_url,
        "Spawning local harness sidecar from precompiled binary"
    );

    let mut cmd = std::process::Command::new(&binary_path);
    cmd.args(["run", "--ui", "none"])
        .env("BIND_ADDR", &host_port)
        .env("BIND_PORT", addr.port().to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    if let Ok(slots) = std::env::var(super::HARNESS_WS_SLOTS_ENV) {
        if !slots.trim().is_empty() {
            cmd.env(super::HARNESS_WS_SLOTS_ENV, slots);
        }
    }

    // Apply the same callback-URL overrides the source-build path
    // uses so the sidecar `HttpDomainApi` posts spec / task / project
    // writes back to THIS server, not whatever `:3100` default the
    // harness's bundled `.env` ships with.
    for (key, value) in derive_harness_url_overrides(env_var_or_none) {
        cmd.env(key, value);
    }

    match cmd.spawn() {
        Ok(mut child) => {
            info!(
                pid = child.id(),
                "aura-harness sidecar process spawned"
            );

            // Stamp LOCAL_HARNESS_URL so the LocalHarness::from_env()
            // call inside `init_domain_services` (which runs after
            // ensure_local_harness_running) connects to the sidecar
            // rather than to a remote SWARM_BASE_URL fallback or the
            // localhost default.
            std::env::set_var("LOCAL_HARNESS_URL", &harness_url);

            let url_for_log = harness_url.clone();
            std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if let Ok(Some(status)) = child.try_wait() {
                        let _ = status;
                        break;
                    }
                    if std::time::Instant::now() > deadline {
                        tracing::warn!(
                            "Timed out waiting for aura-harness sidecar to become ready"
                        );
                        break;
                    }
                    if std::net::TcpStream::connect_timeout(
                        &addr,
                        std::time::Duration::from_millis(200),
                    )
                    .is_ok()
                    {
                        tracing::info!("Local harness sidecar ready at {url_for_log}");
                        break;
                    }
                }
            });
            true
        }
        Err(e) => {
            warn!(
                error = %e,
                binary = %binary_path.display(),
                "Failed to spawn aura-harness sidecar; falling through to source-build autospawn"
            );
            false
        }
    }
}

/// Developer-only spawn path: locate a sibling `aura-harness` checkout
/// and `cargo run --release` it. Never used in production because it
/// requires a Rust toolchain at runtime. Behaviour is unchanged from
/// the original autospawn — only its trigger is new (it now runs
/// only when [`try_spawn_harness_binary`] declined to handle the
/// spawn).
fn spawn_local_harness_from_source() {
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
             Set AURA_HARNESS_DIR, AURA_HARNESS_BIN, or start the harness manually."
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
/// is on, the existing `maybe_spawn_local_harness` path tries the
/// bundled-binary spawn (production shape, mirrors the desktop
/// sidecar) and falls back to the dev-only source-build path; both
/// outcomes either succeed or log their own warnings, so this
/// preflight stays in the `Ok` arm and lets that flow run.
///
/// When autospawn is off (the operator has explicitly opted out, or
/// the deployment relies on a remote harness instead of a local
/// sidecar), the resolved URL is the only thing standing between
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
             `local harness websocket connect failed`. Either drop \
             AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN so the bundled \
             aura-node sidecar can launch, or set SWARM_BASE_URL / \
             LOCAL_HARNESS_URL on the Render dashboard to a \
             deployed aura-node service URL.",
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
        assert!(
            message.contains("AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN"),
            "preflight message must mention the autospawn-disable env var as a remediation lever, got: {message}"
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

    #[test]
    fn harness_binary_filename_matches_platform_convention() {
        let name = harness_binary_filename();
        if cfg!(target_os = "windows") {
            assert_eq!(name, "aura-node.exe");
        } else {
            assert_eq!(name, "aura-node");
        }
    }

    /// `resolve_harness_binary_path` must honour an explicit
    /// `AURA_HARNESS_BIN` env var when it points at a real file. This
    /// is the production-deploy contract: the Render build command
    /// drops the binary at a known path and exports the env var so
    /// resolution doesn't have to fight directory layout heuristics.
    #[test]
    fn resolve_harness_binary_path_respects_aura_harness_bin_when_file_exists() {
        // Use a temp dir so this test stays hermetic and never picks
        // up a stale binary from a previous workspace build.
        let temp = std::env::temp_dir().join(format!(
            "aura-os-server-harness-bin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&temp).unwrap();
        let staged = temp.join(harness_binary_filename());
        std::fs::write(&staged, b"fake-aura-node").unwrap();

        // Save and restore process env so this test doesn't leak into
        // sibling tests via global state. Cargo runs unit tests on a
        // shared process, so any env var we set here would otherwise
        // bleed into `derive_harness_url_overrides_*` and friends.
        let prior = std::env::var("AURA_HARNESS_BIN").ok();
        std::env::set_var("AURA_HARNESS_BIN", &staged);

        let resolved = resolve_harness_binary_path();

        match prior {
            Some(value) => std::env::set_var("AURA_HARNESS_BIN", value),
            None => std::env::remove_var("AURA_HARNESS_BIN"),
        }
        let _ = std::fs::remove_dir_all(&temp);

        assert_eq!(
            resolved.as_deref(),
            Some(staged.as_path()),
            "AURA_HARNESS_BIN must win over candidate-path scanning when the configured file exists"
        );
    }
}
