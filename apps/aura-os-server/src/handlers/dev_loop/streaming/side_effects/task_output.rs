//! Per-task live-output cache helpers (seed/append/usage drain, persist on terminal), plus test-pass evidence accumulation.

use aura_os_core::{AgentInstanceId, ProjectId, SessionId};

use super::super::super::signals::{is_successful_test_run_event, recognized_test_runner_label};
use super::common::parse_task_key;
use crate::state::{AppState, CachedTaskOutput, TestPassEvidence};

pub(super) async fn append_task_output(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    text: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    state
        .task_output_cache
        .lock()
        .await
        .entry(key)
        .or_default()
        .live_output
        .push_str(text);
}

/// Ensure the per-task cache entry exists and is stamped with the
/// forwarder's `session_id`. Called from both the `task_started`
/// side-effect arm and the up-front seed in `run_single_task` so
/// that by the time `persist_task_output` fires on `task_completed`
/// / `task_failed`, the cache already knows which storage session
/// to attribute the `task_output` / `task_steps` / `task_git_steps`
/// events to.
///
/// Without this stamp, both halves of the `persist_task_output`
/// session-id lookup (in-memory cache, fallback to `tasks.session_id`
/// in storage) come up empty for automation and `run_single_task`
/// runs in production — the harness owns task transitions, so
/// `TaskService::assign_task` (the only writer of
/// `tasks.session_id`) is never reached, and `seed_task_output`
/// previously left `CachedTaskOutput::session_id` at its
/// `Default::default()` (None).
///
/// The stamp is idempotent: if the entry already carries a
/// `session_id` (e.g. an earlier `task_started` for the same task)
/// we leave it alone, and we never overwrite a previously-stamped
/// id with `None`.
pub(crate) async fn seed_task_output(
    state: &AppState,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
    task_id: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let mut cache = state.task_output_cache.lock().await;
    seed_task_output_locked(&mut cache, key, project_id, agent_instance_id, session_id);
}

/// Pure cache-mutation half of [`seed_task_output`], extracted so the
/// session-id stamp can be exercised without standing up a full
/// `AppState`. Idempotent: never overwrites an existing `session_id`
/// with `None`, and never clobbers a previously-stamped id with a
/// different one (the first writer wins, matching the contract on
/// `CachedTaskOutput::session_id` documented in `state::caches`).
fn seed_task_output_locked(
    cache: &mut std::collections::HashMap<crate::state::TaskOutputKey, CachedTaskOutput>,
    key: crate::state::TaskOutputKey,
    project_id: ProjectId,
    agent_instance_id: AgentInstanceId,
    session_id: Option<SessionId>,
) {
    let entry = cache.entry(key).or_insert_with(|| CachedTaskOutput {
        project_id: Some(project_id.to_string()),
        agent_instance_id: Some(agent_instance_id.to_string()),
        ..Default::default()
    });
    if entry.session_id.is_none() {
        if let Some(sid) = session_id {
            entry.session_id = Some(sid.to_string());
        }
    }
}

pub(super) async fn update_usage_cache(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let usage = event.get("usage").unwrap_or(event);
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    if let Some(model) = usage.get("model").and_then(|value| value.as_str()) {
        entry.model = Some(model.to_string());
    }
    if let Some(provider) = usage.get("provider").and_then(|value| value.as_str()) {
        entry.provider = Some(provider.to_string());
    }
    if let Some(input) = usage.get("input_tokens").and_then(|value| value.as_u64()) {
        entry.input_tokens = entry.input_tokens.saturating_add(input);
        entry.total_input_tokens = entry.total_input_tokens.saturating_add(input);
    }
    if let Some(output) = usage.get("output_tokens").and_then(|value| value.as_u64()) {
        entry.output_tokens = entry.output_tokens.saturating_add(output);
        entry.total_output_tokens = entry.total_output_tokens.saturating_add(output);
    }
    if let Some(v) = usage
        .get("cache_creation_input_tokens")
        .and_then(|value| value.as_u64())
    {
        entry.total_cache_creation_input_tokens =
            entry.total_cache_creation_input_tokens.saturating_add(v);
    }
    if let Some(v) = usage
        .get("cache_read_input_tokens")
        .and_then(|value| value.as_u64())
    {
        entry.total_cache_read_input_tokens = entry.total_cache_read_input_tokens.saturating_add(v);
    }
}

/// Drain the in-memory accumulator for `task_id` and persist it to
/// aura-storage via `persist_task_output`. Called once per task on
/// `task_completed` or `task_failed`.
///
/// Bridges the live-event accumulator (`task_output_cache`) to the
/// persisted `tasks` row + session events. The cache entry is removed
/// after persistence so the in-memory map doesn't grow unbounded
/// across task completions.
pub(super) async fn persist_cached_task_output(
    state: &AppState,
    project_id: ProjectId,
    jwt: &str,
    task_id: &str,
) {
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let cached = {
        let mut cache = state.task_output_cache.lock().await;
        cache.remove(&key)
    };
    let Some(cached) = cached else {
        return;
    };
    crate::persistence::persist_task_output(
        state.storage_client.as_ref(),
        Some(jwt),
        task_id,
        &cached,
    )
    .await;
}

/// Accumulate evidence when the harness reports a successful test-runner
/// invocation. Idempotent: replays of the same event reset the
/// `recorded_at` timestamp but do not double-count anything.
pub(super) async fn record_test_pass_evidence(
    state: &AppState,
    project_id: ProjectId,
    task_id: &str,
    event: &serde_json::Value,
) {
    if !is_successful_test_run_event("tool_call_completed", event) {
        return;
    }
    let Some(key) = parse_task_key(project_id, task_id) else {
        return;
    };
    let command = event
        .get("input")
        .and_then(|input| {
            input
                .get("command")
                .or_else(|| input.get("cmd"))
                .or_else(|| input.get("shell_command"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            event
                .get("input")
                .and_then(|input| input.get("args"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
        })
        .unwrap_or_default();
    let Some(runner) = recognized_test_runner_label(&command) else {
        return;
    };
    let evidence = TestPassEvidence {
        runner,
        command,
        recorded_at: chrono::Utc::now().to_rfc3339(),
    };
    let mut cache = state.task_output_cache.lock().await;
    let entry = cache.entry(key).or_default();
    entry.test_pass_evidence = Some(evidence);
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{AgentInstanceId, ProjectId, SessionId, TaskId};
    use std::collections::HashMap;

    fn key(project_id: ProjectId, task_id: TaskId) -> crate::state::TaskOutputKey {
        (project_id, task_id)
    }

    #[test]
    fn seed_stamps_session_id_when_creating_entry() {
        let mut cache = HashMap::new();
        let project_id = ProjectId::new();
        let agent_instance_id = AgentInstanceId::new();
        let session_id = SessionId::new();
        let task_id = TaskId::new();
        seed_task_output_locked(
            &mut cache,
            key(project_id, task_id),
            project_id,
            agent_instance_id,
            Some(session_id),
        );
        let entry = cache.get(&key(project_id, task_id)).expect("entry exists");
        assert_eq!(entry.session_id.as_deref(), Some(&*session_id.to_string()));
        assert_eq!(
            entry.project_id.as_deref(),
            Some(&*project_id.to_string()),
            "seed should also stamp project_id on fresh entries"
        );
        assert_eq!(
            entry.agent_instance_id.as_deref(),
            Some(&*agent_instance_id.to_string()),
            "seed should also stamp agent_instance_id on fresh entries"
        );
    }

    #[test]
    fn seed_back_fills_session_id_on_existing_entry() {
        let mut cache = HashMap::new();
        let project_id = ProjectId::new();
        let agent_instance_id = AgentInstanceId::new();
        let task_id = TaskId::new();
        cache.insert(
            key(project_id, task_id),
            CachedTaskOutput {
                live_output: "preexisting text from a text_delta race".into(),
                ..Default::default()
            },
        );
        let session_id = SessionId::new();
        seed_task_output_locked(
            &mut cache,
            key(project_id, task_id),
            project_id,
            agent_instance_id,
            Some(session_id),
        );
        let entry = cache.get(&key(project_id, task_id)).expect("entry exists");
        assert_eq!(
            entry.session_id.as_deref(),
            Some(&*session_id.to_string()),
            "session_id must be back-filled even when entry pre-existed"
        );
        assert_eq!(
            entry.live_output, "preexisting text from a text_delta race",
            "back-fill must not clobber accumulated live output"
        );
    }

    #[test]
    fn seed_is_idempotent_first_writer_wins() {
        let mut cache = HashMap::new();
        let project_id = ProjectId::new();
        let agent_instance_id = AgentInstanceId::new();
        let task_id = TaskId::new();
        let first = SessionId::new();
        let second = SessionId::new();
        assert_ne!(first, second, "test bug: minted equal session ids");
        seed_task_output_locked(
            &mut cache,
            key(project_id, task_id),
            project_id,
            agent_instance_id,
            Some(first),
        );
        seed_task_output_locked(
            &mut cache,
            key(project_id, task_id),
            project_id,
            agent_instance_id,
            Some(second),
        );
        let entry = cache.get(&key(project_id, task_id)).expect("entry exists");
        assert_eq!(
            entry.session_id.as_deref(),
            Some(&*first.to_string()),
            "second seed call must not overwrite the first writer's session_id"
        );
    }

    #[test]
    fn seed_with_none_session_id_leaves_existing_id_intact() {
        let mut cache = HashMap::new();
        let project_id = ProjectId::new();
        let agent_instance_id = AgentInstanceId::new();
        let task_id = TaskId::new();
        let session_id = SessionId::new();
        cache.insert(
            key(project_id, task_id),
            CachedTaskOutput {
                session_id: Some(session_id.to_string()),
                ..Default::default()
            },
        );
        seed_task_output_locked(
            &mut cache,
            key(project_id, task_id),
            project_id,
            agent_instance_id,
            None,
        );
        let entry = cache.get(&key(project_id, task_id)).expect("entry exists");
        assert_eq!(
            entry.session_id.as_deref(),
            Some(&*session_id.to_string()),
            "passing None must never clear a previously-stamped session_id"
        );
    }
}
