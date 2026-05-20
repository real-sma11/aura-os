//! Regression tests for the cancel-mid-tool-use Anthropic 400.
//!
//! Reproduces the user-visible `messages.N.content.M.tool_use.input:
//! Input should be an object` 400 the user hits after pressing Stop
//! during a streaming tool call, and proves that:
//!
//! 1. `session_events_to_agent_history` heals an already-corrupt
//!    historical assistant turn whose `content_blocks` were written
//!    to storage with `input: null` (legacy data, pre-finalize-sweep
//!    fix) into a valid Anthropic shape.
//! 2. `assistant_blocks_to_api`'s API-edge defense coerces the
//!    `input` field to `{}` even when somehow the upstream layers
//!    missed it.
//! 3. The synthetic-`tool_result` shape produced by the persist
//!    task's finalize sweep round-trips correctly through compaction.

use aura_os_core::ChatContentBlock;

use super::super::super::compaction::session_events_to_agent_history;
use super::{assert_anthropic_messages_valid, assistant_event, user_event};

#[test]
fn agent_history_heals_legacy_null_tool_use_input_to_empty_object() {
    // Exact storage shape produced by a cancel-mid-tool-call before
    // the finalize-sweep fix landed: an assistant turn with a
    // `tool_use` carrying `input: null` AND a paired (synthetic)
    // tool_result. The `input: null` was the immediate cause of the
    // user-visible 400 `tool_use.input: Input should be an object`.
    //
    // We expect the heal-on-load (`sanitize_assistant_content_blocks`)
    // and the API-edge guard in `assistant_blocks_to_api` to coerce
    // `input` to `{}` so the constructed Anthropic message array is
    // accepted on replay.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_cancelled".into(),
                name: "create_spec".into(),
                input: serde_json::Value::Null,
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_cancelled".into(),
                content: "[cancelled by user before tool call completed; no result was produced]"
                    .into(),
                is_error: Some(true),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("just create specs"), assistant]);

    assert_anthropic_messages_valid(&history);

    // Locate the assistant message and confirm the tool_use input
    // landed as a JSON object (not null, not string, not missing).
    let assistant_msg = history
        .iter()
        .find(|m| m.get("role").and_then(|v| v.as_str()) == Some("assistant"))
        .expect("compaction must emit an assistant message");
    let blocks = assistant_msg
        .get("content")
        .and_then(|c| c.as_array())
        .expect("assistant content must be a block array");
    let tool_use = blocks
        .iter()
        .find(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .expect("compaction must keep the tool_use block (it has a paired result)");
    let input = tool_use.get("input").expect("tool_use must carry input");
    assert!(
        input.is_object(),
        "tool_use.input must be coerced to a JSON object; got {input}"
    );
    assert_eq!(
        input,
        &serde_json::json!({}),
        "the heal must default to empty-object args, not invent fields"
    );
}

#[test]
fn agent_history_heals_legacy_string_tool_use_input_to_empty_object() {
    // Mid-stream `input_json_delta` accumulator that leaked into
    // storage on a legacy harness build (post-fix, those events are
    // skipped at write time — but pre-fix sessions can still hold
    // them). Heal-on-load must coerce to `{}` so Anthropic accepts
    // the replay.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_partial".into(),
                name: "create_spec".into(),
                input: serde_json::Value::String(r#"{"title":"Phase"#.to_string()),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_partial".into(),
                content: "[cancelled by user before tool call completed; no result was produced]"
                    .into(),
                is_error: Some(true),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("just create specs"), assistant]);
    assert_anthropic_messages_valid(&history);
}

#[test]
fn agent_history_heals_legacy_array_tool_use_input_to_empty_object() {
    // Genuinely-corrupt historical row: `tool_use.input` was an array.
    // Anthropic's 400 message is the same. Heal-on-load coerces.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_array".into(),
                name: "create_spec".into(),
                input: serde_json::json!(["not", "an", "object"]),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_array".into(),
                content: "ok".into(),
                is_error: Some(false),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("go"), assistant]);
    assert_anthropic_messages_valid(&history);
}

#[test]
fn agent_history_drops_dangling_tool_use_with_null_input() {
    // Cancel-mid-tool-call with NO synthetic tool_result (pre-fix
    // shape AND any path where the synthetic tool_result write
    // failed). The existing dangling-tool_use strip should drop the
    // unpaired tool_use entirely so Anthropic doesn't 400 on either
    // (a) the missing tool_result OR (b) the null input. The heal
    // defenses (Layer 2 + Layer 3) make this defense-in-depth: even
    // if the strip ever regresses, the input would still be coerced.
    let assistant = assistant_event(
        "",
        Some(vec![ChatContentBlock::ToolUse {
            id: "toolu_dangling".into(),
            name: "create_spec".into(),
            input: serde_json::Value::Null,
        }]),
    );

    let history = session_events_to_agent_history(&[user_event("create specs"), assistant]);
    assert_anthropic_messages_valid(&history);

    // The dangling tool_use must be stripped (not emitted as a
    // valid-but-unpaired block). The assistant message either is
    // absent entirely (no content_blocks survived) or contains zero
    // tool_use blocks.
    let assistant_blocks: Vec<&serde_json::Value> = history
        .iter()
        .filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("assistant"))
        .filter_map(|m| m.get("content").and_then(|c| c.as_array()))
        .flat_map(|arr| arr.iter())
        .collect();
    let surviving_tool_uses = assistant_blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .count();
    assert_eq!(
        surviving_tool_uses, 0,
        "dangling tool_use (no tool_result) must be stripped, not emitted with healed input"
    );
}

#[test]
fn agent_history_paired_synthetic_cancellation_round_trips_cleanly() {
    // Post-fix happy path: the persist task's finalize sweep
    // normalised the cancelled tool_use to `input: {}` AND emitted a
    // synthetic tool_result with `is_error: true`. This is what new
    // sessions write to storage on Stop. Replay must produce a
    // perfectly valid Anthropic message array with no warnings.
    let assistant = assistant_event(
        "",
        Some(vec![
            ChatContentBlock::ToolUse {
                id: "toolu_post_fix".into(),
                name: "create_spec".into(),
                input: serde_json::json!({}),
            },
            ChatContentBlock::ToolResult {
                tool_use_id: "toolu_post_fix".into(),
                content: "[cancelled by user before tool call completed; no result was produced]"
                    .into(),
                is_error: Some(true),
            },
        ]),
    );

    let history = session_events_to_agent_history(&[user_event("just create specs"), assistant]);
    assert_anthropic_messages_valid(&history);
}
