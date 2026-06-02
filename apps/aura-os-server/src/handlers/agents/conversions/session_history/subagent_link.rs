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

/// Stamp `subagent_session_id` into the `extra` of every subagent
/// tool_use block whose child run has a matching `subagent_session`
/// linkage event. Handles two block shapes:
///
/// - An ordinary `task` spawn carries a scalar `child_run_id`; the
///   linked session id is stamped at the block root.
/// - An AURA Council turn carries a `council_members` array (members
///   share ONE parent block); each member is stamped by its own
///   `child_run_id` so a reopened council column can fetch its
///   persisted transcript.
///
/// No-op when the session spawned no subagents.
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
    // Ordinary `task` spawn: scalar `child_run_id` at the block root.
    if let Some(child_run_id) = extra.get("child_run_id").and_then(|v| v.as_str()) {
        // Clone before mutating `extra` so the immutable borrow above ends.
        if let Some(session_id) = links.get(child_run_id).cloned() {
            extra.insert("subagent_session_id".to_string(), json!(session_id));
        }
    }
    // AURA Council turn: each member carries its own `child_run_id` in
    // the `council_members` array.
    if let Some(members) = extra
        .get_mut("council_members")
        .and_then(|v| v.as_array_mut())
    {
        for member in members.iter_mut() {
            let Some(child_run_id) = member.get("child_run_id").and_then(|v| v.as_str()) else {
                continue;
            };
            let Some(session_id) = links.get(child_run_id).cloned() else {
                continue;
            };
            if let Some(obj) = member.as_object_mut() {
                obj.insert("subagent_session_id".to_string(), json!(session_id));
            }
        }
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

    fn assistant_with_council_block(child_run_ids: &[&str]) -> SessionEvent {
        let members: Vec<serde_json::Value> = child_run_ids
            .iter()
            .enumerate()
            .map(|(i, id)| {
                json!({
                    "child_run_id": id,
                    "council_index": i,
                    "model": format!("provider/model-{i}"),
                })
            })
            .collect();
        let mut extra = serde_json::Map::new();
        extra.insert("council_members".to_string(), json!(members));
        SessionEvent {
            event_id: SessionEventId::new(),
            agent_instance_id: AgentInstanceId::nil(),
            project_id: ProjectId::nil(),
            role: ChatRole::Assistant,
            content: String::new(),
            content_blocks: Some(vec![ChatContentBlock::ToolUse {
                id: "toolu_council".to_string(),
                name: "Task".to_string(),
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

    fn council_member_session_id(message: &SessionEvent, child_run_id: &str) -> Option<String> {
        let blocks = message.content_blocks.as_ref()?;
        for block in blocks {
            if let ChatContentBlock::ToolUse { extra, .. } = block {
                let members = extra.get("council_members")?.as_array()?;
                for member in members {
                    if member.get("child_run_id").and_then(|v| v.as_str()) == Some(child_run_id) {
                        return member
                            .get("subagent_session_id")
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                    }
                }
            }
        }
        None
    }

    #[test]
    fn stamps_session_id_onto_each_matching_council_member() {
        let mut messages = vec![assistant_with_council_block(&["child-a", "child-b"])];
        let sorted = vec![
            link_event("child-a", "session-a"),
            link_event("child-b", "session-b"),
        ];
        fold_subagent_session_links(&mut messages, &sorted);
        assert_eq!(
            council_member_session_id(&messages[0], "child-a").as_deref(),
            Some("session-a"),
            "each council member is stamped by its own child run id",
        );
        assert_eq!(
            council_member_session_id(&messages[0], "child-b").as_deref(),
            Some("session-b"),
        );
    }

    #[test]
    fn leaves_unlinked_council_member_untouched() {
        let mut messages = vec![assistant_with_council_block(&["child-a", "child-b"])];
        // Only one member has a link; the other must stay unstamped.
        let sorted = vec![link_event("child-a", "session-a")];
        fold_subagent_session_links(&mut messages, &sorted);
        assert_eq!(
            council_member_session_id(&messages[0], "child-a").as_deref(),
            Some("session-a"),
        );
        assert!(
            council_member_session_id(&messages[0], "child-b").is_none(),
            "a council member with no matching link must not be stamped",
        );
    }
}
