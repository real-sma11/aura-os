//! Computer-use activation gate for chat turns (Phase 5 capture-mode glue).
//!
//! The desktop shell embeds this server in the *same process*. At bind time
//! it publishes its local executor base URL via `AURA_COMPUTER_EXECUTOR_URL`
//! (see `apps/aura-os-desktop/src/net/server.rs`), and it sets
//! `AURA_COMPUTER_USE_ENABLED` only while a computer-use `/record_demo`
//! session is active.
//!
//! We enable the Anthropic computer-use capability for a chat turn ONLY when
//! BOTH signals are present, so it is OFF by default and never enabled
//! globally without an explicit desktop opt-in.
//!
//! Approach note: an env flag is used rather than a per-turn request flag
//! because the demo bridge drives ordinary chat turns from a separate demo
//! window context; threading a flag end-to-end through that bridge would be
//! far more invasive. The flag stays set for the remainder of the desktop
//! process session (single-user desktop MVP); finer per-turn scoping is a
//! follow-up.

/// Env var carrying the desktop computer-use executor base URL.
const EXECUTOR_URL_ENV: &str = "AURA_COMPUTER_EXECUTOR_URL";
/// Env var the desktop sets to opt a session into computer-use.
const ENABLED_ENV: &str = "AURA_COMPUTER_USE_ENABLED";

/// Resolved `(computer_use, computer_executor_url)` fields for a chat
/// `SessionConfig`. The executor URL is populated whenever the desktop
/// published one; `computer_use` is enabled only when the desktop also
/// explicitly opted in.
pub(super) fn computer_use_session_fields() -> (bool, Option<String>) {
    let executor_url = std::env::var(EXECUTOR_URL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let opted_in = std::env::var(ENABLED_ENV)
        .map(|value| env_flag_enabled(&value))
        .unwrap_or(false);
    let enabled = opted_in && executor_url.is_some();
    (enabled, executor_url)
}

/// Truthy env-flag values (case-insensitive). Anything else is treated as
/// disabled.
fn env_flag_enabled(value: &str) -> bool {
    matches!(
        value.trim(),
        "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
    )
}

#[cfg(test)]
mod tests {
    use super::env_flag_enabled;

    #[test]
    fn env_flag_truthy_values() {
        for value in ["1", "true", "TRUE", "yes", "on", " on "] {
            assert!(env_flag_enabled(value), "expected truthy: {value:?}");
        }
    }

    #[test]
    fn env_flag_falsy_values() {
        for value in ["0", "false", "no", "off", ""] {
            assert!(!env_flag_enabled(value), "expected falsy: {value:?}");
        }
    }
}
