//! Unit tests for the chat handler module. Split into focused files
//! so each test module stays under the 500-line cap.
//!
//! The legacy `identity_preamble_tests` module was retired in the
//! chat-WS migration alongside `identity_preamble.rs` /
//! `project_prompt.rs`: the chat handlers now forward typed
//! identity / project-info wire fields and the harness's
//! `SystemPromptBuilder` owns the assembly + ordering invariants
//! (covered by the `chat_with_identity*` snapshot tests in
//! `aura-agent`'s `prompts::system::tests`).

#[cfg(test)]
mod errors_tests;

#[cfg(test)]
mod discovery_tests;

#[cfg(test)]
mod compaction_tests;

#[cfg(test)]
mod project_state_tests;
