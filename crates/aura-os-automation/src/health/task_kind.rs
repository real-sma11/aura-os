//! Heuristic [`TaskKind`] classifier driven off the task description
//! and the extracted [`TaskScope`].
//!
//! Phase 1 of `workspace-health-diff-gate`. Pure, deterministic. The
//! plan calls for stamping a `kind` field on the task itself in a later
//! phase; until then this heuristic is the source of truth.
//!
//! Heuristic order (first match wins):
//!
//! 1. **Empty inputs** — empty description AND empty scope →
//!    [`TaskKind::Unknown`].
//! 2. **Documentation** — non-empty scope where every `paths` entry
//!    ends in `.md` or lives under `docs/`. Description content is
//!    ignored at this step because a doc-only scope is the strongest
//!    signal we have.
//! 3. **Verification** — description contains the word `audit`,
//!    `review`, or `verify`, or the phrase `check that`.
//! 4. **Refactor** — description contains the word `refactor`,
//!    `rename`, or `move`.
//! 5. **Implementation** — fallthrough default.
//!
//! Tokenization is `split_whitespace` + ASCII-only alphanumeric
//! splitting so keyword matches respect word boundaries (e.g.
//! `improve` does not match `move`, `remove` does not match `move`).

use crate::health::task_scope::TaskScope;
use crate::health::types::TaskKind;

/// Classify a task into one of the [`TaskKind`] variants. See the
/// module-level doc for the exact heuristic order.
#[must_use]
pub fn classify_task_kind(description: &str, scope: &TaskScope) -> TaskKind {
    let trimmed = description.trim();
    if trimmed.is_empty() && scope.is_empty() {
        return TaskKind::Unknown;
    }

    if scope_is_doc_only(scope) {
        return TaskKind::Documentation;
    }

    let lowered = trimmed.to_ascii_lowercase();
    let tokens: Vec<&str> = lowered
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();

    if has_token(&tokens, "audit")
        || has_token(&tokens, "review")
        || has_token(&tokens, "verify")
        || lowered.contains("check that")
    {
        return TaskKind::Verification;
    }

    if has_token(&tokens, "refactor")
        || has_token(&tokens, "rename")
        || has_token(&tokens, "move")
    {
        return TaskKind::Refactor;
    }

    TaskKind::Implementation
}

/// True when `scope` has at least one path AND every path looks like
/// documentation (`.md` suffix or `docs/` prefix). Crates-only scopes
/// do not qualify — code-targeting scopes default to implementation.
fn scope_is_doc_only(scope: &TaskScope) -> bool {
    if scope.paths.is_empty() {
        return false;
    }
    if !scope.crates.is_empty() {
        // Mention of a code crate disqualifies the doc-only verdict
        // even if the paths happen to be markdown — the agent is on
        // the hook for the code surface too.
        return false;
    }
    scope
        .paths
        .iter()
        .all(|p| p.ends_with(".md") || p.starts_with("docs/"))
}

fn has_token(tokens: &[&str], needle: &str) -> bool {
    tokens.iter().any(|t| *t == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::task_scope::extract_task_scope;

    #[test]
    fn documentation_scope_classifies_as_documentation() {
        let scope = extract_task_scope(
            "Write the new GRID conformance README.md and update docs/grid.md",
            &[],
        );
        // Sanity check: extract_task_scope must produce a doc-only scope here.
        assert!(scope.crates.is_empty(), "scope: {scope:?}");
        assert!(!scope.paths.is_empty(), "scope: {scope:?}");
        assert_eq!(
            classify_task_kind("Write the new GRID conformance README.md", &scope),
            TaskKind::Documentation,
        );
    }

    #[test]
    fn verification_keywords_classify_as_verification() {
        let scope = extract_task_scope("Audit the health gate wiring.", &[]);
        assert_eq!(
            classify_task_kind("Audit the health gate wiring", &scope),
            TaskKind::Verification,
        );
        assert_eq!(
            classify_task_kind("Please review the recent changes", &TaskScope::default()),
            TaskKind::Verification,
        );
        assert_eq!(
            classify_task_kind("check that the cargo build is clean", &TaskScope::default()),
            TaskKind::Verification,
        );
    }

    #[test]
    fn refactor_keywords_classify_as_refactor() {
        assert_eq!(
            classify_task_kind(
                "Refactor the dev_loop module to share state",
                &TaskScope::default()
            ),
            TaskKind::Refactor,
        );
        assert_eq!(
            classify_task_kind("Rename the LoopRetryState field", &TaskScope::default()),
            TaskKind::Refactor,
        );
        assert_eq!(
            classify_task_kind(
                "Move the snapshot helper into the health module",
                &TaskScope::default()
            ),
            TaskKind::Refactor,
        );
    }

    #[test]
    fn implementation_is_the_default_fallthrough_for_code_tasks() {
        let scope = extract_task_scope(
            "Add a Snapshot type and wire it into crates/aura-os-automation",
            &[],
        );
        assert!(
            scope.crates.contains("aura-os-automation"),
            "scope: {scope:?}"
        );
        assert_eq!(
            classify_task_kind(
                "Add a Snapshot type and wire it into crates/aura-os-automation",
                &scope
            ),
            TaskKind::Implementation,
        );
    }

    #[test]
    fn empty_inputs_classify_as_unknown() {
        assert_eq!(
            classify_task_kind("", &TaskScope::default()),
            TaskKind::Unknown,
        );
        assert_eq!(
            classify_task_kind("   \n\t   ", &TaskScope::default()),
            TaskKind::Unknown,
        );
    }

    #[test]
    fn token_matching_respects_word_boundaries() {
        // `improve` must NOT count as `move`, and `remove` must NOT
        // count as `move`. If the heuristic regressed to a substring
        // match these would incorrectly produce `Refactor`.
        assert_eq!(
            classify_task_kind("Improve the docs once we have evidence", &TaskScope::default()),
            TaskKind::Implementation,
        );
        assert_eq!(
            classify_task_kind("Remove the legacy gate after migration", &TaskScope::default()),
            TaskKind::Implementation,
        );
    }
}
