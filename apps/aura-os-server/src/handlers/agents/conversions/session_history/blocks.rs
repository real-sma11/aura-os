use std::collections::HashSet;

use tracing::warn;

use aura_os_core::ChatContentBlock;

/// Deserialize a stored `content_blocks` JSON array per-entry so that one
/// malformed or unknown variant does not discard the whole vector.
///
/// Anything that fails to deserialize into a known `ChatContentBlock` variant
/// is logged and skipped. This is strictly more forgiving than
/// `serde_json::from_value::<Vec<ChatContentBlock>>`, which is all-or-nothing.
pub(super) fn deserialize_content_blocks(
    event_id: &str,
    raw_blocks: Vec<serde_json::Value>,
) -> Vec<ChatContentBlock> {
    let mut blocks = Vec::with_capacity(raw_blocks.len());
    for (idx, raw) in raw_blocks.into_iter().enumerate() {
        match serde_json::from_value::<ChatContentBlock>(raw.clone()) {
            Ok(block) => blocks.push(block),
            Err(error) => {
                let block_type = raw
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("<unknown>");
                warn!(
                    %event_id,
                    block_index = idx,
                    block_type,
                    %error,
                    "skipping unparseable chat content block while reconstructing assistant turn"
                );
            }
        }
    }
    blocks
}

/// Sanitize the assistant `content_blocks` we just reconstructed from
/// storage so they are safe to feed back into a future Anthropic
/// Messages API request.
///
/// Two heal-on-load cleanups happen here:
///
/// 1. **`write_file` with no body** is dropped (along with its paired
///    `tool_result`) — historical pre-fix shape that arrived when a
///    `write_file` snapshot landed without the `content` string.
///
/// 2. **Any `tool_use` with non-object `input`** is healed in place by
///    coercing `input` to an empty object `{}`. This is the heal-on-load
///    counterpart to `persist_task_dispatch::normalize::coerce_tool_use_input_to_object`:
///    sessions persisted *before* the cancel-finalize sweep landed
///    (and any session corrupted by an upstream regression we haven't
///    found yet) carry `tool_use.input: null` (or string / array)
///    and would otherwise replay as the Anthropic 400
///    `messages.N.content.M.tool_use.input: Input should be an object`.
///    Coercing here means already-poisoned sessions become replayable
///    on the next message without a storage migration.
pub(super) fn sanitize_assistant_content_blocks(
    blocks: Vec<ChatContentBlock>,
) -> Vec<ChatContentBlock> {
    let mut suppressed_tool_use_ids = HashSet::new();
    let mut sanitized = Vec::with_capacity(blocks.len());

    for block in blocks {
        match block {
            ChatContentBlock::ToolUse { id, name, input }
                if is_incomplete_write_tool_use(&name, &input) =>
            {
                suppressed_tool_use_ids.insert(id);
            }
            ChatContentBlock::ToolUse { id, name, input } => {
                let healed_input = if input.is_object() {
                    input
                } else {
                    warn!(
                        tool_use_id = %id,
                        %name,
                        original_type = json_value_type_name(&input),
                        "healing stored tool_use.input that is not a JSON object to {{}} so replay does not 400 on Anthropic"
                    );
                    serde_json::json!({})
                };
                sanitized.push(ChatContentBlock::ToolUse {
                    id,
                    name,
                    input: healed_input,
                });
            }
            ChatContentBlock::ToolResult { tool_use_id, .. }
                if suppressed_tool_use_ids.contains(&tool_use_id) =>
            {
                continue;
            }
            other => sanitized.push(other),
        }
    }

    sanitized
}

fn is_incomplete_write_tool_use(name: &str, input: &serde_json::Value) -> bool {
    if name != "write_file" {
        return false;
    }

    match input {
        serde_json::Value::Null => true,
        serde_json::Value::Object(map) => {
            !matches!(map.get("content"), Some(serde_json::Value::String(_)))
        }
        _ => false,
    }
}

fn json_value_type_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "bool",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_heals_null_tool_use_input_to_empty_object() {
        // The exact storage shape produced by a cancel-mid-tool-call
        // before the finalize-sweep fix: `tool_use` with `input: null`
        // and no paired `tool_result`. Anthropic 400s on replay with
        // `tool_use.input: Input should be an object`. Healing here
        // means already-poisoned sessions remain replayable.
        let blocks = vec![ChatContentBlock::ToolUse {
            id: "toolu_cancelled".into(),
            name: "create_spec".into(),
            input: serde_json::Value::Null,
        }];
        let sanitized = sanitize_assistant_content_blocks(blocks);
        assert_eq!(sanitized.len(), 1);
        match &sanitized[0] {
            ChatContentBlock::ToolUse { id, input, .. } => {
                assert_eq!(id, "toolu_cancelled");
                assert_eq!(*input, serde_json::json!({}));
            }
            other => panic!("expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn sanitize_heals_string_tool_use_input_to_empty_object() {
        // Mid-stream input_json_delta state could have leaked into
        // storage on a pre-fix harness build. We coerce to `{}` rather
        // than try to parse — the parsing path lives in
        // `persist_task_dispatch::normalize` and runs at write time;
        // this is the read-time heal of last resort.
        let blocks = vec![ChatContentBlock::ToolUse {
            id: "toolu_partial".into(),
            name: "list_files".into(),
            input: serde_json::Value::String(r#"{"path":"src/"#.to_string()),
        }];
        let sanitized = sanitize_assistant_content_blocks(blocks);
        match &sanitized[0] {
            ChatContentBlock::ToolUse { input, .. } => {
                assert_eq!(*input, serde_json::json!({}));
            }
            other => panic!("expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn sanitize_passes_through_object_tool_use_input_unchanged() {
        let original = serde_json::json!({"path": "src/lib.rs"});
        let blocks = vec![ChatContentBlock::ToolUse {
            id: "toolu_ok".into(),
            name: "read_file".into(),
            input: original.clone(),
        }];
        let sanitized = sanitize_assistant_content_blocks(blocks);
        match &sanitized[0] {
            ChatContentBlock::ToolUse { input, .. } => assert_eq!(*input, original),
            other => panic!("expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn sanitize_heals_arbitrary_tool_name_not_just_write_file() {
        // The pre-fix narrow `write_file`-only check missed any other
        // tool that landed with non-object input. Generic tool name
        // (`create_spec`) must be healed too.
        let blocks = vec![ChatContentBlock::ToolUse {
            id: "toolu_array".into(),
            name: "create_spec".into(),
            input: serde_json::json!([1, 2, 3]),
        }];
        let sanitized = sanitize_assistant_content_blocks(blocks);
        match &sanitized[0] {
            ChatContentBlock::ToolUse { input, .. } => assert_eq!(*input, serde_json::json!({})),
            other => panic!("expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn sanitize_still_drops_incomplete_write_file_and_its_result() {
        // Regression guard: heal-on-load must not remove the existing
        // narrow `write_file` skip. Incomplete `write_file` (no
        // `content` string) and its paired `tool_result` are both
        // dropped — that's load-bearing for the desktop write-file
        // approval UX.
        let blocks = vec![
            ChatContentBlock::ToolUse {
                id: "toolu_write".into(),
                name: "write_file".into(),
                input: serde_json::Value::Null,
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_write".into(),
                content: "should not appear".into(),
                is_error: Some(false),
            },
        ];
        let sanitized = sanitize_assistant_content_blocks(blocks);
        assert!(
            sanitized.is_empty(),
            "incomplete write_file and its paired tool_result must both drop"
        );
    }
}
