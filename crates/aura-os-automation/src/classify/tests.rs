//! Table-driven tests for the classifier family.
//!
//! Phase 1 of `simplify dev-loop / harness automation`: the substring
//! matchers that used to live in [`super::transient`] (deleted) are
//! now consumed exclusively via the typed
//! [`aura_os_harness::signals::HarnessFailureKind`] enum. The tests
//! below pin the surviving in-crate classifier — the git-push
//! subclassifier in [`super::push`] — and continue to mirror the
//! production traces that motivated each row so a regression fails
//! fast at `cargo test -p aura-os-automation`.

use super::push::classify_push_failure;

#[test]
fn classify_push_failure_returns_subclass_labels() {
    assert_eq!(
        classify_push_failure("git push orbit HEAD:main: timed out after 60s"),
        Some("push_timeout"),
    );
    assert_eq!(
        classify_push_failure("remote: error: No space left on device"),
        Some("remote_storage_exhausted"),
    );
    assert_eq!(
        classify_push_failure("git_push_failed: remote rejected (pre-receive hook declined)"),
        Some("push_failed"),
    );
    assert_eq!(
        classify_push_failure("syntax error in generated code"),
        None,
        "non-push reasons must not classify",
    );
}
