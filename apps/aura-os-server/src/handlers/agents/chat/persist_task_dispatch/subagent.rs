//! Dispatch arms for the live-subagent-thread protocol:
//! `SubagentSpawned` and `SubagentStatus`. These flow on the PARENT
//! chat stream and record the parent→child linkage so the persisted
//! assistant turn can later surface (and re-attach to) the child
//! subagent thread spawned by a `task` tool call.
//!
//! Linkage is carried entirely inside the event `content` JSON — the
//! `StorageSessionEvent` content column is arbitrary JSON, so no DB
//! migration is needed. We also stamp `child_run_id` onto the matching
//! `tool_use` content block of the in-flight assistant turn so a replay
//! of the persisted history can render the live thread under the
//! originating tool card.

use serde_json::json;

use super::super::persist::ChatPersistCtx;
use super::super::persist_task::{persist_event, PersistTaskState};

/// Handle a `subagent_spawned` event: stamp `child_run_id` onto the
/// originating `task` tool_use block (when `parent_tool_use_id` is
/// known) and persist a `subagent_spawned` linkage event carrying the
/// parent session id, parent tool-use id, child run id, subagent type,
/// and spawn prompt.
pub(super) async fn handle_subagent_spawned(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    child_run_id: &str,
    parent_tool_use_id: Option<&str>,
    subagent_type: &str,
    prompt: &str,
) {
    if let Some(parent_id) = parent_tool_use_id.filter(|s| !s.is_empty()) {
        if let Some(block) = state.content_blocks.iter_mut().rev().find(|b| {
            b.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                && b.get("id").and_then(|i| i.as_str()) == Some(parent_id)
        }) {
            block["child_run_id"] = json!(child_run_id);
        }
    }

    if persist_event(
        ctx,
        "subagent_spawned",
        json!({
            "message_id": &state.message_id,
            "parent_session_id": ctx.session_id.to_string(),
            "parent_tool_use_id": parent_tool_use_id,
            "child_run_id": child_run_id,
            "subagent_type": subagent_type,
            "prompt": prompt,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

/// Handle a `subagent_status` event: persist the transitional/terminal
/// state for a previously announced child run so the persisted thread
/// card reflects running/completed/failed/etc.
pub(super) async fn handle_subagent_status(
    state: &mut PersistTaskState,
    ctx: &ChatPersistCtx,
    child_run_id: &str,
    child_state: &str,
    reason: Option<&str>,
) {
    if persist_event(
        ctx,
        "subagent_status",
        json!({
            "message_id": &state.message_id,
            "child_run_id": child_run_id,
            "state": child_state,
            "reason": reason,
            "seq": state.seq,
        }),
    )
    .await
    {
        state.persisted_events += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn test_ctx() -> ChatPersistCtx {
        ChatPersistCtx {
            storage: std::sync::Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://127.0.0.1:1",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: None,
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        }
    }

    #[tokio::test]
    async fn subagent_spawned_stamps_child_run_id_on_parent_tool_use_block() {
        // A `task` tool_use block is already in the assistant turn; the
        // spawn event must stamp the child run id onto it so a replay of
        // the persisted history can attach to the live child thread.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-task".to_string();
        state.content_blocks.push(json!({
            "type": "tool_use",
            "id": "toolu_task_1",
            "name": "Task",
            "input": json!({"prompt": "explore"}),
        }));

        let ctx = test_ctx();
        handle_subagent_spawned(
            &mut state,
            &ctx,
            "child-run-123",
            Some("toolu_task_1"),
            "explore",
            "explore the repo",
        )
        .await;

        let block = state
            .content_blocks
            .iter()
            .find(|b| b.get("id").and_then(Value::as_str) == Some("toolu_task_1"))
            .expect("task tool_use block present");
        assert_eq!(
            block.get("child_run_id").and_then(Value::as_str),
            Some("child-run-123"),
            "spawn must link the child run id onto the originating tool_use block",
        );
    }

    #[tokio::test]
    async fn subagent_spawned_without_parent_id_does_not_panic() {
        // Missing/empty parent_tool_use_id must be tolerated: we simply
        // skip the tool_use block stamping and still persist the event.
        let mut state = PersistTaskState::new();
        state.message_id = "msg-task".to_string();
        let ctx = test_ctx();
        handle_subagent_spawned(&mut state, &ctx, "child-run-x", None, "explore", "go").await;
        assert!(
            state.content_blocks.is_empty(),
            "no tool_use block to stamp when parent id is absent",
        );
    }
}
