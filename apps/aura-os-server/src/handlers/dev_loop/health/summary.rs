//! Deterministic `WorkspaceHealth` rendering for the dev-loop
//! completion gate.

use std::collections::BTreeMap;

use super::types::{HealthError, WorkspaceHealth};

/// Build a short, deterministic summary of the workspace error set.
///
/// Format:
///
/// ```text
/// workspace red at task start: N errors across M files (e.g. \
///     crates/zero-storage [E0277 ×2, E0432], crates/zero-identity [E0425])
/// ```
///
/// * Files are sorted lexicographically and clamped to the first 3 so
///   the prompt header stays bounded regardless of how many errors
///   `cargo` emitted.
/// * Within a file's bracket, distinct error codes are listed
///   alphabetically; the Unicode multiplication sign `\u{00d7}` is
///   used as a count suffix (`E0277 ×2`) when a code repeats.
///   Errors with no code (`HealthError::code == None`) are still
///   counted in `N` but omitted from the per-file bracket.
#[must_use]
pub(crate) fn format_health_summary(health: &WorkspaceHealth) -> String {
    let errors = health.errors();
    let total_errors = errors.len();

    let mut by_file: BTreeMap<&str, Vec<&HealthError>> = BTreeMap::new();
    for err in errors {
        by_file.entry(err.file.as_str()).or_default().push(err);
    }
    let total_files = by_file.len();

    let file_fragments: Vec<String> = by_file
        .iter()
        .take(3)
        .map(|(file, errs)| {
            let mut code_counts: BTreeMap<&str, usize> = BTreeMap::new();
            for e in errs.iter() {
                if let Some(code) = &e.code {
                    *code_counts.entry(code.as_str()).or_insert(0) += 1;
                }
            }
            if code_counts.is_empty() {
                (*file).to_string()
            } else {
                let codes: Vec<String> = code_counts
                    .iter()
                    .map(|(code, count)| {
                        if *count > 1 {
                            format!("{code} \u{00d7}{count}")
                        } else {
                            (*code).to_string()
                        }
                    })
                    .collect();
                format!("{file} [{}]", codes.join(", "))
            }
        })
        .collect();

    if file_fragments.is_empty() {
        format!("workspace red at task start: {total_errors} errors across {total_files} files",)
    } else {
        format!(
            "workspace red at task start: {total_errors} errors across {total_files} files \
             (e.g. {})",
            file_fragments.join(", "),
        )
    }
}

#[cfg(test)]
mod tests {
    //! `format_health_summary` deterministic-output regression.

    use super::*;
    use super::super::types::WorkspaceHealth;

    fn mk_err(file: &str, code: Option<&str>, kind: &str) -> HealthError {
        HealthError {
            file: file.to_owned(),
            code: code.map(str::to_owned),
            kind: kind.to_owned(),
        }
    }

    #[test]
    fn orders_files_lexicographically_and_clamps_to_three() {
        let health = WorkspaceHealth::failing(vec![
            mk_err("crates/zzz-last/src/lib.rs", Some("E0001"), "k"),
            mk_err("crates/bbb-second/src/lib.rs", Some("E0002"), "k"),
            mk_err("crates/aaa-first/src/lib.rs", Some("E0003"), "k"),
            mk_err("crates/ddd-fourth/src/lib.rs", Some("E0004"), "k"),
            mk_err("crates/ccc-third/src/lib.rs", Some("E0005"), "k"),
        ]);
        let summary = format_health_summary(&health);
        assert!(summary.contains("crates/aaa-first"), "{summary}");
        assert!(summary.contains("crates/bbb-second"), "{summary}");
        assert!(summary.contains("crates/ccc-third"), "{summary}");
        assert!(
            !summary.contains("crates/ddd-fourth"),
            "fourth file in lex order must be clamped out: {summary}",
        );
        assert!(
            !summary.contains("crates/zzz-last"),
            "fifth file in lex order must be clamped out: {summary}",
        );
        assert!(
            summary.contains("5 errors across 5 files"),
            "totals must reflect the full error/file count, not the clamped 3: {summary}",
        );
        let aaa = summary.find("crates/aaa-first").unwrap();
        let bbb = summary.find("crates/bbb-second").unwrap();
        let ccc = summary.find("crates/ccc-third").unwrap();
        assert!(
            aaa < bbb && bbb < ccc,
            "files must appear in lex order: {summary}"
        );
    }

    #[test]
    fn uses_unicode_multiplication_sign_for_repeated_error_codes() {
        let health = WorkspaceHealth::failing(vec![
            mk_err("crates/zero-storage/src/key.rs", Some("E0277"), "k"),
            mk_err("crates/zero-storage/src/key.rs", Some("E0277"), "k"),
            mk_err("crates/zero-storage/src/key.rs", Some("E0432"), "k"),
        ]);
        let summary = format_health_summary(&health);
        assert!(
            summary.contains("E0277 \u{00d7}2"),
            "repeated code must be rendered with the ×N suffix: {summary}",
        );
        assert!(
            summary.contains("E0432"),
            "singleton code must appear without a count suffix: {summary}",
        );
        assert!(
            !summary.contains("E0432 \u{00d7}"),
            "singleton code must NOT carry a ×N suffix: {summary}",
        );
    }
}
