//! Build a small `name + role + personality + skills` preamble that
//! mirrors the harness-side `build_agent_preamble`
//! (`crates/aura-agent/src/prompts/system/mod.rs`) used for task
//! execution. The chat hot path historically only forwarded
//! `agent.system_prompt`, so the agent's personality / identity was
//! silently dropped on every interactive turn. Prepending this block
//! before the project-context wrapper restores parity with the task
//! flow and ensures the LLM always sees who it is supposed to be.
//!
//! Returns an empty string when all four identity fields are empty so
//! legacy / blank rows produce a `SessionConfig.system_prompt`
//! byte-identical to the pre-fix output.

/// Format the identity preamble. Trailing newline so the rest of the
/// system prompt (project context block, project state snapshot, raw
/// agent system_prompt) reads cleanly.
#[must_use]
pub(crate) fn build_identity_preamble(
    name: &str,
    role: &str,
    personality: &str,
    skills: &[String],
) -> String {
    let name = name.trim();
    let role = role.trim();
    let personality = personality.trim();
    let has_identity = !name.is_empty() || !role.is_empty() || !personality.is_empty();
    let non_empty_skills: Vec<&str> = skills
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if !has_identity && non_empty_skills.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    if has_identity {
        out.push_str("You are");
        if !name.is_empty() {
            out.push(' ');
            out.push_str(name);
        }
        if !role.is_empty() {
            out.push_str(", a ");
            out.push_str(role);
        }
        out.push('.');
        if !personality.is_empty() {
            out.push(' ');
            out.push_str(personality);
        }
        out.push_str("\n\n");
    }
    if !non_empty_skills.is_empty() {
        out.push_str("Your capabilities include: ");
        out.push_str(&non_empty_skills.join(", "));
        out.push_str(".\n\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::build_identity_preamble;

    #[test]
    fn all_empty_returns_empty_string() {
        let out = build_identity_preamble("", "", "", &[]);
        assert!(
            out.is_empty(),
            "no identity fields => zero-byte preamble so SessionConfig.system_prompt \
             stays byte-identical to the pre-fix output for legacy/blank rows; got {out:?}"
        );
    }

    #[test]
    fn whitespace_only_fields_treated_as_empty() {
        let out = build_identity_preamble("   ", "\t", " ", &["  ".to_string()]);
        assert!(
            out.is_empty(),
            "whitespace-only fields must not produce a 'You are .' artefact"
        );
    }

    #[test]
    fn name_only_emits_minimal_preamble() {
        let out = build_identity_preamble("Atlas", "", "", &[]);
        assert_eq!(out, "You are Atlas.\n\n");
    }

    #[test]
    fn name_and_role_join_with_a() {
        let out = build_identity_preamble("Atlas", "Engineer", "", &[]);
        assert_eq!(out, "You are Atlas, a Engineer.\n\n");
    }

    #[test]
    fn full_identity_with_personality() {
        let out = build_identity_preamble("Atlas", "Engineer", "Precise and methodical.", &[]);
        assert_eq!(
            out,
            "You are Atlas, a Engineer. Precise and methodical.\n\n"
        );
    }

    #[test]
    fn personality_only_still_emits_you_are() {
        let out = build_identity_preamble("", "", "Curious and concise.", &[]);
        assert_eq!(out, "You are. Curious and concise.\n\n");
    }

    #[test]
    fn skills_appended_after_identity() {
        let out = build_identity_preamble(
            "Atlas",
            "Engineer",
            "Precise and methodical.",
            &["Rust".to_string(), "TypeScript".to_string()],
        );
        assert_eq!(
            out,
            "You are Atlas, a Engineer. Precise and methodical.\n\n\
             Your capabilities include: Rust, TypeScript.\n\n"
        );
    }

    #[test]
    fn skills_only_no_identity_still_renders() {
        let out = build_identity_preamble("", "", "", &["Rust".to_string()]);
        assert_eq!(out, "Your capabilities include: Rust.\n\n");
    }

    #[test]
    fn empty_skill_entries_are_filtered() {
        let out = build_identity_preamble(
            "Atlas",
            "",
            "",
            &["Rust".to_string(), "  ".to_string(), "Go".to_string()],
        );
        assert_eq!(
            out,
            "You are Atlas.\n\nYour capabilities include: Rust, Go.\n\n"
        );
    }
}
