//! Regression coverage for the chat-route identity preamble.
//!
//! Both the agent chat route (`agent_route::build_agent_system_prompt`)
//! and the project chat route (`instance_route::send_event_stream`)
//! prepend a `name + role + personality + skills` preamble before
//! handing the prompt to `build_project_system_prompt`. Without that
//! prepend the chat hot path forwards only `system_prompt` and the
//! agent's stored personality / role / skills disappear from the
//! turn — these tests pin down the composition order so a future
//! refactor of either route can't silently regress to that state.
//!
//! We reach into the chat route's identity helper and the
//! `instance_route::render_project_context_fallback` helper directly
//! so the assertions stay free of `AppState` / async / storage setup
//! while still exercising the exact byte sequence the harness will
//! receive in `SessionConfig.system_prompt`.

use aura_os_core::ProjectId;

use super::super::identity_preamble::build_identity_preamble;
use super::super::render_project_context_fallback;

#[test]
fn identity_preamble_lands_before_project_context_block() {
    // Mirrors the composition shape both chat routes apply now:
    //   identity_preamble + project_context + agent.system_prompt
    // Identity has to come BEFORE the project context wrapper so the
    // LLM reads "who am I" before "what project am I operating in",
    // matching the ordering the harness's
    // `agentic_execution_system_prompt` uses for the task path.
    let preamble = build_identity_preamble(
        "Atlas",
        "Engineer",
        "Precise and methodical.",
        &["Rust".to_string(), "TypeScript".to_string()],
    );
    let project_ctx = render_project_context_fallback(&ProjectId::nil());
    let project_block = format!("{project_ctx}You are a helpful project assistant.");
    let final_prompt = format!("{preamble}{project_block}");

    let preamble_pos = final_prompt
        .find("You are Atlas, a Engineer.")
        .expect("identity preamble must land in the final SessionConfig.system_prompt");
    let project_ctx_pos = final_prompt
        .find("<project_context>")
        .expect("project context block must still be present");
    let system_prompt_pos = final_prompt
        .find("You are a helpful project assistant.")
        .expect("agent's stored system_prompt must still be appended");

    assert!(
        preamble_pos < project_ctx_pos,
        "identity preamble must come BEFORE the project context wrapper so the LLM \
         sees who it is supposed to be before it sees project metadata; got \
         preamble_pos={preamble_pos}, project_ctx_pos={project_ctx_pos}\nprompt:\n{final_prompt}"
    );
    assert!(
        project_ctx_pos < system_prompt_pos,
        "project context block must precede the raw agent system_prompt; got \
         project_ctx_pos={project_ctx_pos}, system_prompt_pos={system_prompt_pos}"
    );
    assert!(
        final_prompt.contains("Precise and methodical."),
        "personality must be carried through verbatim; final prompt:\n{final_prompt}"
    );
    assert!(
        final_prompt.contains("Your capabilities include: Rust, TypeScript."),
        "skills line must be carried through verbatim; final prompt:\n{final_prompt}"
    );
}

#[test]
fn empty_identity_preserves_pre_fix_output_byte_for_byte() {
    // Pin down the legacy behaviour for agents whose name / role /
    // personality / skills are all empty: the final
    // `SessionConfig.system_prompt` must be byte-identical to what
    // the chat hot path produced before the preamble landed, so
    // brand-new "New Agent" rows don't suddenly grow a
    // `You are .` artefact in front of their stored prompt.
    let preamble = build_identity_preamble("", "", "", &[]);
    assert!(
        preamble.is_empty(),
        "all-empty identity must produce a zero-byte preamble; got {preamble:?}"
    );

    let pre_fix = {
        let project_ctx = render_project_context_fallback(&ProjectId::nil());
        format!("{project_ctx}{}", "You are a helpful coding agent.")
    };
    let post_fix = {
        let project_ctx = render_project_context_fallback(&ProjectId::nil());
        let project_block = format!("{project_ctx}{}", "You are a helpful coding agent.");
        format!("{preamble}{project_block}")
    };
    assert_eq!(
        pre_fix, post_fix,
        "with all identity fields empty, the composed prompt must match the pre-fix output \
         byte-for-byte; otherwise legacy/blank-row chats see a behaviour change"
    );
}
