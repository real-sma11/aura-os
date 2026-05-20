//! Workspace-health snapshot fingerprint + pure `cargo check` parser.
//!
//! Phase 1 of `workspace-health-diff-gate`. This module owns:
//!
//! * [`Snapshot`] — newtype around [`super::types::WorkspaceHealth`]
//!   plus a content-hash signature computed by [`compute_signature`].
//!   Downstream phases stash this on `LoopRetryState` and compare two
//!   signatures to short-circuit the diff classifier.
//! * [`parse_cargo_check_json_output`] — pure parser for the
//!   `cargo check --message-format=json` JSON-lines shape. NO `cargo`
//!   invocation lives here; the App layer runs the command and feeds
//!   the captured stdout in.
//!
//! `blake3` is the workspace-pinned content-hash used elsewhere in the
//! tree (see `Cargo.toml`'s `[workspace.dependencies]` `blake3 = "1.5"`).
//! Using it here keeps signatures interoperable with future tooling
//! (e.g. dumping a baseline to disk) without inventing a new hash flavor.

use crate::health::types::{BuildStatus, HealthError, TestStatus, WorkspaceHealth};

/// `WorkspaceHealth` plus a stable content-hash signature.
///
/// The signature is computed over the **sorted, deduped** set of
/// `(file, code, kind)` triples plus a token for the `TestStatus`. Line
/// numbers and column ranges are deliberately NOT mixed in: cosmetic
/// edits ahead of a stable error would otherwise look like a brand-new
/// diagnostic and trip a spurious `workspace_health_regressed`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// The underlying health verdict.
    pub health: WorkspaceHealth,
    /// blake3 hash of the dedup-sorted `(file, code, kind)` triples
    /// concatenated with the test-status token.
    pub signature: blake3::Hash,
}

impl Snapshot {
    /// Build a `Snapshot` from a `WorkspaceHealth`, recomputing the
    /// signature so callers never see a stale fingerprint.
    #[must_use]
    pub fn new(health: WorkspaceHealth) -> Self {
        let signature = compute_signature(&health);
        Self { health, signature }
    }

    /// True when the underlying health is clean.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.health.is_clean()
    }
}

/// Compute the deterministic content-hash signature for a
/// [`WorkspaceHealth`].
///
/// Stable across:
///
/// * Reordering of diagnostics within the build output (we sort).
/// * Duplicate diagnostics emitted by repeated cargo passes (we
///   dedup).
/// * Line / column changes upstream of an otherwise-identical error.
///
/// NOT stable across:
///
/// * Changes to the file path, error code, or first-line message.
/// * Test status transitions (passing → failing flips the signature).
#[must_use]
pub fn compute_signature(health: &WorkspaceHealth) -> blake3::Hash {
    let mut triples: Vec<(&str, &str, &str)> = health
        .errors()
        .iter()
        .map(|e| {
            (
                e.file.as_str(),
                e.code.as_deref().unwrap_or(""),
                e.kind.as_str(),
            )
        })
        .collect();
    triples.sort();
    triples.dedup();

    let mut hasher = blake3::Hasher::new();
    for (file, code, kind) in &triples {
        hasher.update(file.as_bytes());
        hasher.update(b"\0");
        hasher.update(code.as_bytes());
        hasher.update(b"\0");
        hasher.update(kind.as_bytes());
        hasher.update(b"\n");
    }
    let test_token: &[u8] = match health.test_status {
        TestStatus::Passing => b"test:pass",
        TestStatus::Failing => b"test:fail",
        TestStatus::Unknown => b"test:unknown",
    };
    hasher.update(test_token);
    let build_token: &[u8] = match health.build_status {
        BuildStatus::Passing => b"|build:pass",
        BuildStatus::Failing { .. } => b"|build:fail",
    };
    hasher.update(build_token);
    hasher.finalize()
}

/// Parse `cargo check --message-format=json` stdout into a flat vector
/// of [`HealthError`]s.
///
/// Each input line is independently `serde_json::from_str`'d. Lines
/// that fail to parse, or that are not `reason = "compiler-message"`
/// with `message.level == "error"`, are silently skipped — `cargo`
/// interleaves `build-script-executed`, `compiler-artifact`, and other
/// reasons that aren't diagnostics.
///
/// The returned vector preserves the encounter order so the App
/// layer's logging surface stays predictable; the diff classifier
/// treats it as an unordered multiset.
///
/// Path normalization is the caller's responsibility — cargo emits
/// absolute paths by default; the App layer typically strips the
/// workspace root prefix before storing.
#[must_use]
pub fn parse_cargo_check_json_output(stdout: &str) -> Vec<HealthError> {
    let mut errors = Vec::new();
    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if value.get("reason").and_then(|r| r.as_str()) != Some("compiler-message") {
            continue;
        }
        let message = match value.get("message") {
            Some(m) => m,
            None => continue,
        };
        let level = message.get("level").and_then(|l| l.as_str()).unwrap_or("");
        if level != "error" {
            continue;
        }
        let code = message
            .get("code")
            .and_then(|c| c.get("code"))
            .and_then(|c| c.as_str())
            .map(str::to_owned);
        let kind = message
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_owned();
        let file = primary_file_from_spans(message);
        errors.push(HealthError { file, code, kind });
    }
    errors
}

/// Extract the most-relevant source file from a compiler-message's
/// `spans` array. Prefers the span with `is_primary == true`, falling
/// back to the first span, falling back to an empty string.
fn primary_file_from_spans(message: &serde_json::Value) -> String {
    let spans = match message.get("spans").and_then(|s| s.as_array()) {
        Some(arr) => arr,
        None => return String::new(),
    };
    let primary = spans
        .iter()
        .find(|span| {
            span.get("is_primary")
                .and_then(|p| p.as_bool())
                .unwrap_or(false)
        })
        .or_else(|| spans.first());
    primary
        .and_then(|span| span.get("file_name"))
        .and_then(|f| f.as_str())
        .unwrap_or("")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `cargo check --message-format=json` line for a clean workspace
    /// typically only emits `compiler-artifact` reasons and a final
    /// `build-finished` line — no `compiler-message` with level=error.
    /// We additionally throw in a warning to prove the level filter
    /// works.
    const CLEAN_OUTPUT: &str = r#"
{"reason":"compiler-artifact","package_id":"foo","target":{"name":"foo","src_path":"crates/foo/src/lib.rs"}}
{"reason":"compiler-message","package_id":"foo","message":{"level":"warning","message":"unused variable: `x`","code":{"code":"unused_variables"},"spans":[{"file_name":"crates/foo/src/lib.rs","is_primary":true}]}}
{"reason":"build-finished","success":true}
"#;

    /// Sample with two real errors and one warning, plus interleaved
    /// non-message lines, plus a malformed line to exercise the
    /// silent-skip path.
    const FAILING_OUTPUT: &str = r#"
{"reason":"compiler-artifact","package_id":"foo","target":{}}
{"reason":"compiler-message","package_id":"foo","message":{"level":"error","message":"the trait `serde::Serialize` is not implemented for `[u8; 64]`","code":{"code":"E0277"},"spans":[{"file_name":"crates/zero-storage/src/key.rs","line_start":42,"is_primary":true},{"file_name":"crates/zero-storage/src/key.rs","line_start":40,"is_primary":false}]}}
not-json-at-all
{"reason":"compiler-message","package_id":"bar","message":{"level":"warning","message":"unused import","code":{"code":"unused_imports"},"spans":[{"file_name":"crates/bar/src/lib.rs","is_primary":true}]}}
{"reason":"compiler-message","package_id":"foo","message":{"level":"error","message":"unresolved import `crate::zero_identity`","code":{"code":"E0432"},"spans":[{"file_name":"crates/zero-storage/src/lib.rs","is_primary":true}]}}
{"reason":"build-finished","success":false}
"#;

    #[test]
    fn parse_cargo_check_json_output_clean_workspace_yields_no_errors() {
        let errors = parse_cargo_check_json_output(CLEAN_OUTPUT);
        assert!(
            errors.is_empty(),
            "expected zero errors from a clean+warning-only build, got {errors:?}"
        );
    }

    #[test]
    fn parse_cargo_check_json_output_failing_workspace_extracts_each_error() {
        let errors = parse_cargo_check_json_output(FAILING_OUTPUT);
        assert_eq!(errors.len(), 2, "expected 2 errors, got {errors:?}");

        let e0277 = errors
            .iter()
            .find(|e| e.code.as_deref() == Some("E0277"))
            .expect("E0277 should be parsed out");
        assert_eq!(e0277.file, "crates/zero-storage/src/key.rs");
        assert!(
            e0277.kind.contains("Serialize"),
            "kind should preserve message text, got {:?}",
            e0277.kind
        );

        let e0432 = errors
            .iter()
            .find(|e| e.code.as_deref() == Some("E0432"))
            .expect("E0432 should be parsed out");
        assert_eq!(e0432.file, "crates/zero-storage/src/lib.rs");
        assert!(
            e0432.kind.contains("unresolved import"),
            "kind should preserve message text, got {:?}",
            e0432.kind
        );
    }

    #[test]
    fn snapshot_signature_is_order_and_dup_independent() {
        let mk = |errors: Vec<HealthError>| WorkspaceHealth {
            build_status: BuildStatus::Failing { errors },
            test_status: TestStatus::Unknown,
        };
        let a = HealthError {
            file: "crates/a/src/lib.rs".into(),
            code: Some("E0277".into()),
            kind: "trait not implemented".into(),
        };
        let b = HealthError {
            file: "crates/b/src/lib.rs".into(),
            code: Some("E0432".into()),
            kind: "unresolved import".into(),
        };
        let s1 = Snapshot::new(mk(vec![a.clone(), b.clone()]));
        let s2 = Snapshot::new(mk(vec![b.clone(), a.clone(), a.clone()]));
        assert_eq!(
            s1.signature, s2.signature,
            "signature must dedup + sort the triple set"
        );
    }

    #[test]
    fn snapshot_signature_changes_when_kind_changes() {
        let base = WorkspaceHealth::failing(vec![HealthError {
            file: "crates/a/src/lib.rs".into(),
            code: Some("E0277".into()),
            kind: "trait not implemented".into(),
        }]);
        let mut other = base.clone();
        if let BuildStatus::Failing { errors } = &mut other.build_status {
            errors[0].kind = "different message".into();
        }
        assert_ne!(Snapshot::new(base).signature, Snapshot::new(other).signature);
    }
}
