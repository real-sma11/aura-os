//! Canonical resolution of the local harness base URL.
//!
//! In production, `aura-os-server` and the deployed `aura-node`
//! Render service speak two protocols on a single port: the
//! `/stream` WebSocket the [`crate::LocalHarness`] uses for chat /
//! generation sessions, and the `/agents` HTTP API the
//! [`crate::SwarmHarness`] uses to provision per-agent VMs. Operators
//! historically had to set the same URL twice — once as
//! `LOCAL_HARNESS_URL` and once as `SWARM_BASE_URL` — and forgetting
//! either silently broke half the surface (the gap is what produced
//! the "local harness websocket connect failed" outage on aura.ai
//! when only `SWARM_BASE_URL` was wired up).
//!
//! Resolution order:
//!
//! 1. `LOCAL_HARNESS_URL` if non-empty — explicit operator intent
//!    wins, including pointing the two harness paths at different
//!    upstreams when that's actually wanted.
//! 2. `SWARM_BASE_URL` if non-empty — the same `aura-node` that
//!    serves swarm requests already serves `/stream`, so reusing it
//!    "just works" without a second env var.
//! 3. A channel-specific `http://localhost` default — only useful
//!    in local dev where autospawn is bringing up an aura-harness
//!    sibling alongside aura-os-server.

use aura_os_core::Channel;

/// Env var that explicitly configures the local harness base URL.
pub const LOCAL_HARNESS_URL_ENV: &str = "LOCAL_HARNESS_URL";

/// Env var consulted as a fallback when [`LOCAL_HARNESS_URL_ENV`] is
/// unset. The deployed `aura-node` service exposes both protocols on
/// the same port, so a single Render env (already required for
/// remote-mode agents) is enough to power chat too.
pub const HARNESS_URL_SWARM_FALLBACK_ENV: &str = "SWARM_BASE_URL";

/// Where the resolved harness base URL came from. Surfaced to the
/// boot-log line so operators can see at a glance whether an
/// explicit `LOCAL_HARNESS_URL` is in effect or whether the
/// `SWARM_BASE_URL` fallback is doing the work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessUrlSource {
    /// Read from `LOCAL_HARNESS_URL`.
    LocalHarnessUrl,
    /// Read from `SWARM_BASE_URL` because `LOCAL_HARNESS_URL` was unset / blank.
    SwarmBaseUrl,
    /// Channel-specific localhost default. Production should never
    /// land here; if it does, the autospawn preflight in
    /// `aura-os-server` will scream.
    LocalhostDefault,
}

impl HarnessUrlSource {
    /// Human-readable name of the env var (or "default") that
    /// produced this URL. Used in tracing fields and operator-
    /// readable error messages.
    pub fn as_str(&self) -> &'static str {
        match self {
            HarnessUrlSource::LocalHarnessUrl => LOCAL_HARNESS_URL_ENV,
            HarnessUrlSource::SwarmBaseUrl => HARNESS_URL_SWARM_FALLBACK_ENV,
            HarnessUrlSource::LocalhostDefault => "localhost-default",
        }
    }
}

/// Resolved harness base URL plus the env var it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedHarnessUrl {
    pub url: String,
    pub source: HarnessUrlSource,
}

/// Returns the configured local harness base URL, trimmed of trailing
/// slashes. See module docs for the resolution order.
pub fn local_harness_base_url() -> String {
    resolve_local_harness_base_url(|key| std::env::var(key).ok()).url
}

/// Same as [`local_harness_base_url`] but also returns the env var
/// (or "default") that produced the value. Lets callers stamp the
/// resolution source into a tracing record at startup so misconfig
/// noise has unambiguous attribution.
pub fn resolved_local_harness_base_url() -> ResolvedHarnessUrl {
    resolve_local_harness_base_url(|key| std::env::var(key).ok())
}

/// Resolution core. Parameterised on `read` so unit tests can stub
/// the environment without poking at process-global state — same
/// pattern `aura-os-server`'s `derive_harness_url_overrides` already
/// uses.
pub fn resolve_local_harness_base_url<F>(read: F) -> ResolvedHarnessUrl
where
    F: Fn(&str) -> Option<String>,
{
    if let Some(url) = read(LOCAL_HARNESS_URL_ENV).and_then(non_empty_trimmed) {
        return ResolvedHarnessUrl {
            url,
            source: HarnessUrlSource::LocalHarnessUrl,
        };
    }
    if let Some(url) = read(HARNESS_URL_SWARM_FALLBACK_ENV).and_then(non_empty_trimmed) {
        return ResolvedHarnessUrl {
            url,
            source: HarnessUrlSource::SwarmBaseUrl,
        };
    }
    ResolvedHarnessUrl {
        url: format!(
            "http://localhost:{}",
            Channel::current().default_harness_port()
        ),
        source: HarnessUrlSource::LocalhostDefault,
    }
}

/// Trim whitespace + trailing slashes; return `None` for the empty
/// string so a `KEY=` line in a `.env` file doesn't masquerade as an
/// explicit configuration intent.
fn non_empty_trimmed(raw: String) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
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
    fn explicit_local_harness_url_wins_over_swarm_fallback() {
        let read = reader_from(&[
            ("LOCAL_HARNESS_URL", "https://harness.example.com"),
            ("SWARM_BASE_URL", "https://swarm.example.com"),
        ]);
        let resolved = resolve_local_harness_base_url(read);
        assert_eq!(resolved.url, "https://harness.example.com");
        assert_eq!(resolved.source, HarnessUrlSource::LocalHarnessUrl);
    }

    #[test]
    fn falls_back_to_swarm_base_url_when_local_unset() {
        let read = reader_from(&[("SWARM_BASE_URL", "https://aura-node.onrender.com")]);
        let resolved = resolve_local_harness_base_url(read);
        assert_eq!(resolved.url, "https://aura-node.onrender.com");
        assert_eq!(resolved.source, HarnessUrlSource::SwarmBaseUrl);
    }

    #[test]
    fn falls_back_to_swarm_base_url_when_local_is_blank() {
        // Treat `LOCAL_HARNESS_URL=   ` and `LOCAL_HARNESS_URL=` as
        // unset, not as "explicit empty intent". An empty entry in a
        // `.env` overlay is the same shape as a forgotten Render
        // dashboard cell, and we'd rather pick up the swarm URL than
        // dial a malformed empty WS target.
        for blank in ["", "   ", "\t"] {
            // Bind to a local because `blank` is a loop variable —
            // inline `&[...]` runs into the same borrow-lifetime
            // issue documented in `app_builder::harness_autospawn`'s
            // preflight loopback-URL test.
            let pairs = [
                ("LOCAL_HARNESS_URL", blank),
                ("SWARM_BASE_URL", "https://aura-node.onrender.com"),
            ];
            let read = reader_from(&pairs);
            let resolved = resolve_local_harness_base_url(read);
            assert_eq!(resolved.source, HarnessUrlSource::SwarmBaseUrl);
            assert_eq!(resolved.url, "https://aura-node.onrender.com");
        }
    }

    #[test]
    fn defaults_to_localhost_when_both_unset() {
        let read = reader_from(&[]);
        let resolved = resolve_local_harness_base_url(read);
        assert_eq!(resolved.source, HarnessUrlSource::LocalhostDefault);
        assert!(
            resolved.url.starts_with("http://localhost:"),
            "expected channel-specific localhost default, got: {}",
            resolved.url
        );
    }

    #[test]
    fn trims_trailing_slashes_from_either_source() {
        let read_local = reader_from(&[("LOCAL_HARNESS_URL", "https://harness.example.com/")]);
        assert_eq!(
            resolve_local_harness_base_url(read_local).url,
            "https://harness.example.com"
        );
        let read_swarm = reader_from(&[("SWARM_BASE_URL", "https://swarm.example.com//")]);
        assert_eq!(
            resolve_local_harness_base_url(read_swarm).url,
            "https://swarm.example.com"
        );
    }

    #[test]
    fn source_as_str_matches_env_var_names() {
        assert_eq!(
            HarnessUrlSource::LocalHarnessUrl.as_str(),
            LOCAL_HARNESS_URL_ENV
        );
        assert_eq!(
            HarnessUrlSource::SwarmBaseUrl.as_str(),
            HARNESS_URL_SWARM_FALLBACK_ENV
        );
        assert_eq!(
            HarnessUrlSource::LocalhostDefault.as_str(),
            "localhost-default"
        );
    }
}
