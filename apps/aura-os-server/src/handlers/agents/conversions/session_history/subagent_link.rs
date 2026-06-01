//! Read-time fold that stamps `subagent_session_id` onto the originating
//! `task` tool_use block when reconstructing parent chat history.
//!
//! The subagent-capture path writes a [`SUBAGENT_SESSION_LINK_EVENT`]
//! row into the parent session mapping a child run to the dedicated
//! storage session holding its transcript. The capture path and the
//! parent chat persist task are independent consumers of the parent
//! stream, so the session id is delivered to the client here — at
//! read time, race-free — rather than stamped at write time. The client
//! reads `subagent_session_id` off the block to fetch the persisted
//! child transcript when a history-reopened card's live run is gone.

use std::collections::HashMap;

use serde_json::json;

use aura_os_core::{ChatContentBlock, SessionEvent};
use aura_os_storage::StorageSessionEvent;

use crate::handlers::agents::chat::SUBAGENT_SESSION_LINK_EVENT;

/// Stamp `subagent_session_id` into the `extra` of every `task` tool_use
/// block whose `child_run_id` has a matching `subagent_session` linkage
/// event. No-op when the session spawned no subagents.
pub(super) fn fold_subagent_session_links(
    messages: &mut [SessionEvent],
    sorted: &[StorageSessionEvent],
) {
    let links = build_link_map(sorted);
    if links.is_empty() {
        return;
    }
    for message in messages.iter_mut() {
        let Some(blocks) = message.content_blocks.as_mut() else {
            continue;
        };
        for block in blocks.iter_mut() {
            stamp_block(block, &links);
        }
    }
}

fn stamp_block(block: &mut ChatContentBlock, links: &HashMap<String, String>) {
    let ChatContentBlock::ToolUse { extra, .. } = block else {
        return;
    };
    let Some(child_run_id) = extra.get("child_run_id").and_then(|v| v.as_str()) else {
        return;
    };
    // Clone before mutating `extra` so the immutable borrow above ends.
    if let Some(session_id) = links.get(child_run_id).cloned() {
        extra.insert("subagent_session_id".to_string(), json!(session_id));
    }
}

fn build_link_map(sorted: &[StorageSessionEvent]) -> HashMap<String, String> {
    let mut links = HashMap::new();
    for event in sorted {
        if event.event_type.as_deref() != Some(SUBAGENT_SESSION_LINK_EVENT) {
            continue;
        }
        let Some(content) = event.content.as_ref() else {
            continue;
        };
        let (Some(child_run_id), Some(session_id)) = (
            content.get("child_run_id").and_then(|v| v.as_str()),
            content.get("subagent_session_id").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        links.insert(child_run_id.to_string(), session_id.to_string());
    }
    links
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_core::{parse_dt, AgentInstanceId, ChatRole, ProjectId, SessionEventId};

    fn link_event(child_run_id: &str, session_id: &str) -> StorageSessionEvent {
        StorageSessionEvent {
            id: "evt".to_string(),
            session_id: Some("parent".to_string()),
            user_id: None,
            agent_id: None,
            sender: Some("agent".to_string()),
            project_id: None,
            org_id: None,
            event_type: Some(SUBAGENT_SESSION_LINK_EVENT.to_string()),
            content: Some(json!({
                "child_run_id": child_run_id,
                "subagent_session_id": session_id,
            })),
            created_at: Some("2026-01-01T00:00:00Z".to_string()),
        }
    }

    fn assistant_with_task_block(child_run_id: &str) -> SessionEvent {
        let mut extra = serde_json::Map::new();
        extra.insert("child_run_id".to_string(), json!(child_run_id));
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::Assistant,
            content: String::new(),
            content_blocks: Some(vec![ChatContentBlock::ToolUse {
                id: "toolu_task".to_string(),
                name: "task".to_string(),
                input: json!({}),
                extra,
            }]),
            thinking: None,
            thinking_duration_ms: None,
            created_at: parse_dt(&Some("2026-01-01T00:00:00Z".to_string())),
            in_flight: None,
            from_agent_id: None,
        }
    }

    fn tool_use_session_id(message: &SessionEvent) -> Option<String> {
        let blocks = message.content_blocks.as_ref()?;
        for block in blocks {
            if let ChatContentBlock::ToolUse { extra, .. } = block {
                if let Some(value) = extra.get("subagent_session_id").and_then(|v| v.as_str()) {
                    return Some(value.to_string());
                }
            }
        }
        None
    }

    #[test]
    fn stamps_session_id_onto_matching_task_block() {
        let mut messages = vec![assistant_with_task_block("child-1")];
        let sorted = vec![link_event("child-1", "session-abc")];
        fold_subagent_session_links(&mut messages, &sorted);
        assert_eq!(
            tool_use_session_id(&messages[0]).as_deref(),
            Some("session-abc"),
            "the linked subagent session id must be stamped onto the task block",
        );
    }

    #[test]
    fn leaves_unrelated_blocks_untouched() {
        let mut messages = vec![assistant_with_task_block("child-1")];
        // Link event for a different child run — must not stamp.
        let sorted = vec![link_event("child-other", "session-xyz")];
        fold_subagent_session_links(&mut messages, &sorted);
        assert!(
            tool_use_session_id(&messages[0]).is_none(),
            "a non-matching link must not stamp a session id",
        );
    }

    #[test]
    fn no_links_is_a_noop() {
        let mut messages = vec![assistant_with_task_block("child-1")];
        fold_subagent_session_links(&mut messages, &[]);
        assert!(tool_use_session_id(&messages[0]).is_none());
    }
}
