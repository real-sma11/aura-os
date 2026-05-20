//! Pure extraction of "what does this task claim to touch?".
//!
//! Phase 1 of `workspace-health-diff-gate`. The diff classifier needs
//! to answer "does the still-red file set intersect what the task
//! claimed to touch?" so it can distinguish `UnfixedInScope` (must
//! block) from `RedBlockingImplementation` / `UnchangedAdvisory` (the
//! red is somewhere else).
//!
//! Inputs:
//!
//! * `description: &str` — the task's free-form description; tokenized
//!   with `split_whitespace` and scanned for `crates/<name>` segments
//!   and tokens that look like file paths.
//! * `plan_files: &[String]` — paths the task's submitted plan named
//!   explicitly. Always trusted; added verbatim to `scope.paths`.
//!
//! Output is a [`TaskScope`] with two `BTreeSet`s so intersection
//! works at both crate and file granularity. Order is stable across
//! runs (the sets are sorted), which keeps the advisory message text
//! deterministic for snapshot-based tests downstream.

use std::collections::BTreeSet;

use crate::health::types::HealthError;

/// The set of paths and crates a task explicitly named as its
/// expected work surface.
///
/// Empty inputs produce an empty scope; downstream classifiers treat
/// "empty scope" as "the task did not claim any particular area" and
/// fall through to the `Implementation`-vs-`Doc/Refactor/Verification`
/// branch of the verdict matrix.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TaskScope {
    /// Workspace-relative paths (files or directories). May overlap
    /// with `crates` when a `crates/<name>` token was mentioned.
    pub paths: BTreeSet<String>,
    /// Crate names extracted from `crates/<name>` mentions.
    pub crates: BTreeSet<String>,
}

impl TaskScope {
    /// True when neither set has any entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.paths.is_empty() && self.crates.is_empty()
    }

    /// True when any of the supplied errors' `file` field falls inside
    /// this scope. Matches at three granularities:
    ///
    /// 1. Exact path equality against `paths`.
    /// 2. Prefix match against `paths` (treats each path as a
    ///    directory prefix).
    /// 3. Crate prefix: when the error file is `crates/<name>/...`
    ///    and `crates` contains `<name>`.
    #[must_use]
    pub fn intersects_errors(&self, errors: &[HealthError]) -> bool {
        errors.iter().any(|e| self.contains_file(&e.file))
    }

    /// Test whether a single workspace-relative file path is inside
    /// the scope. Public so downstream advisory builders can re-use
    /// the matching logic without re-implementing it.
    #[must_use]
    pub fn contains_file(&self, file: &str) -> bool {
        let file = file.trim_start_matches("./");
        for path in &self.paths {
            let path = path.trim_start_matches("./");
            if path.is_empty() {
                continue;
            }
            if file == path {
                return true;
            }
            // Treat the scope path as a directory prefix when it
            // doesn't already end with `/`.
            let trimmed = path.trim_end_matches('/');
            if file.starts_with(&format!("{trimmed}/")) {
                return true;
            }
        }
        if let Some(rest) = file.strip_prefix("crates/") {
            if let Some(crate_name) = rest.split('/').next() {
                if self.crates.contains(crate_name) {
                    return true;
                }
            }
        }
        false
    }
}

/// Extract a [`TaskScope`] from a task description and the list of
/// files its submitted plan named.
///
/// Tokenization is intentionally regex-free per the Phase 1 plan:
///
/// * Split the description on whitespace.
/// * Strip surrounding punctuation (`,.;:!?()[]{}<>"'` and matching
///   characters) from each token.
/// * Treat any token starting with `crates/` as a crate mention; the
///   segment up to the next `/` becomes a crate name AND
///   `crates/<name>` is added to `paths` so prefix matching works
///   when only the crate (not a specific file) is named.
/// * Treat any other token as a file path candidate when it contains
///   `/` OR ends in one of the known source-file extensions
///   (`.rs`, `.md`, `.toml`, `.ts`, `.tsx`, `.js`, `.json`, `.yaml`,
///   `.yml`, `.html`, `.css`).
///
/// `plan_files` is trusted verbatim: each entry is trimmed and added
/// to `paths`; `crates/<name>` prefixes are also recorded in
/// `crates`.
#[must_use]
pub fn extract_task_scope(description: &str, plan_files: &[String]) -> TaskScope {
    let mut paths: BTreeSet<String> = BTreeSet::new();
    let mut crates: BTreeSet<String> = BTreeSet::new();

    for raw in description.split_whitespace() {
        let token = strip_token_punctuation(raw);
        if token.is_empty() {
            continue;
        }
        absorb_token(token, &mut paths, &mut crates);
    }

    for entry in plan_files {
        let normalized = entry.trim();
        if normalized.is_empty() {
            continue;
        }
        absorb_token(normalized, &mut paths, &mut crates);
    }

    TaskScope { paths, crates }
}

/// Add a single token to `paths` / `crates` if it looks like a path
/// or a `crates/<name>` mention. Tokens that don't qualify are
/// silently dropped — we accept false negatives over false positives
/// so a stray English word like "function" doesn't pollute the
/// scope.
fn absorb_token(token: &str, paths: &mut BTreeSet<String>, crates: &mut BTreeSet<String>) {
    if let Some(rest) = token.strip_prefix("crates/") {
        if let Some(crate_name) = rest.split('/').next() {
            if !crate_name.is_empty() && looks_like_crate_name(crate_name) {
                crates.insert(crate_name.to_owned());
                paths.insert(format!("crates/{crate_name}"));
                // Also record the full path-ish token in case the
                // task named a specific file inside the crate.
                if token.contains('/') && looks_like_file_path(token) {
                    paths.insert(token.to_owned());
                }
                return;
            }
        }
    }
    if looks_like_file_path(token) {
        paths.insert(token.to_owned());
    }
}

/// Heuristic: a token looks like a workspace-relative file path when
/// it either contains a `/` (multi-segment, e.g. `src/lib.rs`,
/// `docs/api.md`) OR ends in a known source-file extension (e.g.
/// `README.md`, `Cargo.toml`).
fn looks_like_file_path(token: &str) -> bool {
    if token.contains('/') {
        return true;
    }
    const KNOWN_EXTS: &[&str] = &[
        ".rs", ".md", ".toml", ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml", ".html",
        ".css", ".scss", ".lock",
    ];
    KNOWN_EXTS.iter().any(|ext| token.ends_with(ext))
}

/// Crate names are lowercase ASCII letters, digits, hyphens, and
/// underscores. Reject anything that looks like a sentence (e.g. an
/// English word stuck after a stray slash).
fn looks_like_crate_name(candidate: &str) -> bool {
    !candidate.is_empty()
        && candidate
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Strip leading + trailing punctuation that's common in prose. We
/// keep `/`, `.`, `_`, `-` (all valid in paths and crate names).
fn strip_token_punctuation(raw: &str) -> &str {
    raw.trim_matches(|c: char| {
        !c.is_ascii_alphanumeric() && c != '/' && c != '.' && c != '_' && c != '-'
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_error(file: &str) -> HealthError {
        HealthError {
            file: file.to_owned(),
            code: None,
            kind: String::new(),
        }
    }

    #[test]
    fn crate_only_scope_extracts_crate_name_and_path_prefix() {
        let scope = extract_task_scope(
            "Fix the `crates/zero-storage` red surface introduced by the previous refactor.",
            &[],
        );
        assert!(scope.crates.contains("zero-storage"), "scope: {scope:?}");
        assert!(
            scope.paths.contains("crates/zero-storage"),
            "scope: {scope:?}"
        );
        assert!(scope.intersects_errors(&[mk_error("crates/zero-storage/src/key.rs")]));
        assert!(!scope.intersects_errors(&[mk_error("crates/aura-os-network/src/types/agent.rs")]));
    }

    #[test]
    fn file_only_scope_extracts_named_files() {
        let scope = extract_task_scope(
            "Update README.md and docs/architecture.md only.",
            &[],
        );
        assert!(scope.paths.contains("README.md"), "scope: {scope:?}");
        assert!(
            scope.paths.contains("docs/architecture.md"),
            "scope: {scope:?}"
        );
        assert!(scope.crates.is_empty(), "no crate tokens expected: {scope:?}");
        assert!(scope.intersects_errors(&[mk_error("README.md")]));
        assert!(scope.intersects_errors(&[mk_error("docs/architecture.md")]));
        assert!(!scope.intersects_errors(&[mk_error("crates/foo/src/lib.rs")]));
    }

    #[test]
    fn mixed_scope_picks_up_both_crates_and_files_from_description_and_plan_files() {
        let scope = extract_task_scope(
            "Touch crates/aura-os-automation and apps/aura-os-server/src/lib.rs to wire the gate.",
            &["docs/notes.md".to_string()],
        );
        assert!(
            scope.crates.contains("aura-os-automation"),
            "scope: {scope:?}"
        );
        assert!(
            scope.paths.contains("apps/aura-os-server/src/lib.rs"),
            "scope: {scope:?}"
        );
        assert!(scope.paths.contains("docs/notes.md"), "scope: {scope:?}");
        // Crate prefix match works for files inside the named crate.
        assert!(scope.intersects_errors(&[mk_error("crates/aura-os-automation/src/health/delta.rs")]));
        // Explicit file path match works.
        assert!(scope.intersects_errors(&[mk_error("apps/aura-os-server/src/lib.rs")]));
        // Files outside both scopes do NOT intersect.
        assert!(!scope.intersects_errors(&[mk_error("crates/aura-os-network/src/types/agent.rs")]));
    }

    #[test]
    fn empty_scope_intersects_nothing_and_reports_empty() {
        let scope = extract_task_scope("Investigate whatever looks promising.", &[]);
        assert!(
            scope.is_empty(),
            "prose-only description without paths or crates must produce empty scope: {scope:?}"
        );
        assert!(!scope.intersects_errors(&[mk_error("crates/foo/src/lib.rs")]));
        assert!(!scope.intersects_errors(&[mk_error("README.md")]));
    }
}
