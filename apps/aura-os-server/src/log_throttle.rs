//! Process-wide token-bucket-lite for rate-limiting `log_line` emissions.
//!
//! High-frequency engine events (`text_delta` heartbeats, repeated
//! tool-call snapshots) would drown the SidekickLog panel if every
//! one fanned out a `log_line`. This module owns a small
//! `DashMap<(project, instance, channel), Instant>` keyed by the
//! emitter so each "channel" of chatter can emit at most once per
//! [`MIN_INTERVAL`].

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use dashmap::DashMap;

pub const MIN_INTERVAL: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub(crate) struct LogThrottleKey {
    pub project_id: String,
    pub agent_instance_id: String,
    pub channel: &'static str,
}

impl LogThrottleKey {
    pub(crate) fn new(
        project_id: impl Into<String>,
        agent_instance_id: impl Into<String>,
        channel: &'static str,
    ) -> Self {
        Self {
            project_id: project_id.into(),
            agent_instance_id: agent_instance_id.into(),
            channel,
        }
    }
}

fn registry() -> &'static DashMap<LogThrottleKey, Instant> {
    static REGISTRY: OnceLock<DashMap<LogThrottleKey, Instant>> = OnceLock::new();
    REGISTRY.get_or_init(DashMap::new)
}

pub(crate) fn should_emit(key: LogThrottleKey) -> bool {
    should_emit_at(key, Instant::now(), MIN_INTERVAL)
}

fn should_emit_at(key: LogThrottleKey, now: Instant, min_interval: Duration) -> bool {
    let map = registry();
    let mut entry = map
        .entry(key)
        .or_insert_with(|| now - min_interval - Duration::from_millis(1));
    if now.duration_since(*entry) >= min_interval {
        *entry = now;
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_key(channel: &'static str) -> LogThrottleKey {
        let pid = format!(
            "proj-{}-{}",
            channel,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        LogThrottleKey::new(pid, "instance-1", channel)
    }

    #[test]
    fn first_emit_passes() {
        let key = fresh_key("first_emit");
        let now = Instant::now();
        assert!(should_emit_at(key, now, Duration::from_millis(1500)));
    }

    #[test]
    fn second_emit_within_window_blocks() {
        let key = fresh_key("within_window");
        let now = Instant::now();
        assert!(should_emit_at(
            key.clone(),
            now,
            Duration::from_millis(1500)
        ));
        assert!(!should_emit_at(
            key,
            now + Duration::from_millis(500),
            Duration::from_millis(1500)
        ));
    }

    #[test]
    fn emit_after_window_passes_again() {
        let key = fresh_key("after_window");
        let now = Instant::now();
        assert!(should_emit_at(
            key.clone(),
            now,
            Duration::from_millis(1500)
        ));
        assert!(should_emit_at(
            key,
            now + Duration::from_millis(1500),
            Duration::from_millis(1500)
        ));
    }
}
