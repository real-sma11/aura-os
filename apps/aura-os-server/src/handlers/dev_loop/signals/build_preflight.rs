//! Server-side build-as-truth gate for `task_completed`.
//!
//! Mirrors the existing "tests-as-truth" override in
//! [`super::super::streaming::side_effects::failure`]. The harness owns
//! task transitions in production, so by the time a `task_completed`
//! event reaches `apply_event_side_effect` the agent has already
//! declared the task done. Without an independent verification step
//! the server happily persists a "done" verdict against a workspace
//! that doesn't actually compile — exactly the failure mode the prior
//! zero-crypto run produced.
//!
//! When `AURA_BUILD_GATE` is set to a truthy value, this module is
//! invoked AFTER the side-effects pipeline picks up `task_completed`
//! but BEFORE the row is persisted. We shell out to
//! `cargo check --message-format=short --quiet` against the resolved
//! workspace; if the build fails, the caller demotes the event to
//! `task_failed` and feeds the truncated stderr back through the
//! standard failure-persistence path.
//!
//! Scope: Rust-only for now. The gate is intentionally opt-in via env
//! var so non-Rust projects (and the existing dashboard) keep their
//! previous behaviour; toggling the flag rolls out the new gate on a
//! per-deployment basis.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Outcome of running `cargo check` for the build gate. The `stderr_tail`
/// already includes the structured error code (when one was found) so
/// the caller can splice it straight into the demoted `task_failed`
/// reason without re-parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BuildPreflight {
    /// Final verdict: `true` when `cargo check` exited 0 within the
    /// timeout.
    pub ok: bool,
    /// First `error[Exxxx]` code surfaced by `cargo check`, when one
    /// could be extracted. Stamped into the failure reason so the
    /// downstream surfaces (`tasks.execution_notes`, dashboard) show
    /// a concrete actionable diagnostic.
    pub first_error_code: Option<String>,
    /// Truncated tail of stderr (max 4 KiB). Sized to match the
    /// `STDERR_TRUNCATE_LIMIT` the harness's `output_to_tool_result`
    /// uses so the operator-facing context stays consistent.
    pub stderr_tail: String,
    /// Wall-clock time spent inside `cargo check`. Useful in metrics /
    /// `task_completed` payload for tuning the timeout knob.
    pub elapsed: Duration,
    /// `true` when the preflight bailed because the process didn't
    /// finish before [`BUILD_GATE_TIMEOUT`] elapsed. Distinguished
    /// from `ok == false` so the demotion message can name the
    /// timeout explicitly.
    pub timed_out: bool,
}

/// Hard timeout for the build gate. Sized to fit the typical
/// `cargo check` walltime on a warm target dir; cold builds may take
/// longer but `task_completed` runs against a warm tree by definition
/// (the agent just finished editing it).
pub(crate) const BUILD_GATE_TIMEOUT: Duration = Duration::from_secs(90);

/// Hard cap on captured stderr bytes. Mirrors the harness's
/// `STDERR_TRUNCATE_LIMIT` so payloads round-trip without growing.
const STDERR_TAIL_LIMIT: usize = 4_000;

/// True when the `AURA_BUILD_GATE` env var is set to a truthy value.
/// Mirrors the existing `auto_decompose_disabled` toggle's parsing
/// (lowercase `1|true|yes|on`).
#[must_use]
pub(crate) fn build_gate_enabled() -> bool {
    std::env::var("AURA_BUILD_GATE")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// Run the build preflight against `workspace_path`. The caller is
/// responsible for honoring [`build_gate_enabled`]; this function
/// always executes when called so it can be exercised directly from
/// tests.
///
/// Returns a structured verdict. We never panic on tooling errors:
/// when `cargo` isn't on `PATH`, the call returns `ok == false` with
/// an explanatory `stderr_tail` so the caller still demotes the task
/// and surfaces "cargo not found" to the operator instead of silently
/// accepting a broken completion.
pub(crate) fn run_build_preflight(workspace_path: &str) -> BuildPreflight {
    let start = Instant::now();

    if workspace_path.trim().is_empty() {
        return BuildPreflight {
            ok: false,
            first_error_code: None,
            stderr_tail: "build preflight: workspace path is empty".to_string(),
            elapsed: Duration::ZERO,
            timed_out: false,
        };
    }
    let path = Path::new(workspace_path);
    if !path.exists() {
        return BuildPreflight {
            ok: false,
            first_error_code: None,
            stderr_tail: format!(
                "build preflight: workspace does not exist on disk: {workspace_path}"
            ),
            elapsed: start.elapsed(),
            timed_out: false,
        };
    }
    if !path.join("Cargo.toml").exists() && !path.join("Cargo.lock").exists() {
        // Not a Cargo workspace. The build gate is Rust-only for now;
        // returning `ok = true` keeps non-Rust projects out of the
        // gate's blast radius while still being a real verdict the
        // caller can pass through.
        return BuildPreflight {
            ok: true,
            first_error_code: None,
            stderr_tail: "build preflight: not a Cargo workspace (skipped)".to_string(),
            elapsed: start.elapsed(),
            timed_out: false,
        };
    }

    let child = Command::new("cargo")
        .args(["check", "--message-format=short", "--quiet"])
        .env("CARGO_TERM_COLOR", "never")
        .env("CARGO_TERM_PROGRESS_WHEN", "never")
        .env("NO_COLOR", "1")
        .current_dir(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let Ok(child) = child else {
        return BuildPreflight {
            ok: false,
            first_error_code: None,
            stderr_tail:
                "build preflight: failed to spawn `cargo check` (cargo not on PATH?). \
                 Disable AURA_BUILD_GATE or install Rust to silence this verdict."
                    .to_string(),
            elapsed: start.elapsed(),
            timed_out: false,
        };
    };

    wait_with_timeout(child, BUILD_GATE_TIMEOUT, start)
}

/// Block-wait for the spawned `cargo check` child, killing it on
/// timeout. Returns the parsed verdict; collapses every internal IO
/// error into a structured `ok = false` so the caller never sees a
/// panic / `Err` from this module.
fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
    started_at: Instant,
) -> BuildPreflight {
    use std::io::Read;
    use std::thread;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = child.stdout.take().map_or_else(Vec::new, |mut s| {
                    let mut buf = Vec::new();
                    let _ = s.read_to_end(&mut buf);
                    buf
                });
                let stderr = child.stderr.take().map_or_else(Vec::new, |mut s| {
                    let mut buf = Vec::new();
                    let _ = s.read_to_end(&mut buf);
                    buf
                });
                let stderr_string = String::from_utf8_lossy(&stderr).to_string();
                let stdout_string = String::from_utf8_lossy(&stdout).to_string();
                // `--message-format=short` puts diagnostics on stdout
                // (the older default routed them via stderr). We
                // search both streams so the parser is format-tolerant
                // and the first-error extraction never misses simply
                // because the format flag flipped between cargo
                // releases.
                let combined = format!("{stdout_string}\n{stderr_string}");
                let first_error_code = extract_first_error_code(&combined);
                let tail = truncate_tail(&combined, STDERR_TAIL_LIMIT);
                return BuildPreflight {
                    ok: status.success(),
                    first_error_code,
                    stderr_tail: tail,
                    elapsed: started_at.elapsed(),
                    timed_out: false,
                };
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    return BuildPreflight {
                        ok: false,
                        first_error_code: None,
                        stderr_tail: format!(
                            "build preflight: `cargo check` exceeded {}s timeout and was killed",
                            timeout.as_secs()
                        ),
                        elapsed: started_at.elapsed(),
                        timed_out: true,
                    };
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(err) => {
                return BuildPreflight {
                    ok: false,
                    first_error_code: None,
                    stderr_tail: format!("build preflight: try_wait failed: {err}"),
                    elapsed: started_at.elapsed(),
                    timed_out: false,
                };
            }
        }
    }
}

/// Pull the first `error[Exxxx]` token out of cargo's combined output
/// so the caller can splice it directly into the failure reason.
fn extract_first_error_code(combined: &str) -> Option<String> {
    for line in combined.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("error[") {
            if let Some(end) = rest.find(']') {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

/// Truncate to a char boundary, marking the cut so the operator can
/// tell at a glance that the tail was dropped on the floor.
fn truncate_tail(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    // Keep the LAST `limit` bytes — diagnostics matter more than the
    // initial banner.
    let start = s.len().saturating_sub(limit);
    let mut start = start;
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    format!("... (truncated to last {limit} bytes)\n{}", &s[start..])
}

/// Render the failure-reason string that the caller stamps onto the
/// demoted `task_failed` event when [`run_build_preflight`] returns
/// `ok == false`. The shape mirrors the existing
/// `build_preflight_failed:` discriminator the dashboard / failure
/// classifier are expected to match on.
#[must_use]
pub(crate) fn render_demoted_failure_reason(preflight: &BuildPreflight) -> String {
    let code = preflight
        .first_error_code
        .as_deref()
        .map_or_else(|| "unknown".to_string(), |c| format!("error[{c}]"));
    if preflight.timed_out {
        return format!(
            "build_preflight_failed: timeout after {}s while running `cargo check`; \
             demoted task_completed to task_failed",
            preflight.elapsed.as_secs()
        );
    }
    format!(
        "build_preflight_failed: {code} surfaced by `cargo check`; \
         demoted task_completed to task_failed"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_first_error_code_from_short_format() {
        let combined = "warning: unused\n\
                        error[E0432]: unresolved import\n  --> src/lib.rs:1:5\n\
                        error[E0277]: trait bound\n";
        assert_eq!(
            extract_first_error_code(combined).as_deref(),
            Some("E0432")
        );
    }

    #[test]
    fn returns_none_on_clean_output() {
        assert_eq!(extract_first_error_code(""), None);
        assert_eq!(extract_first_error_code("Compiling foo v0.1.0\n"), None);
        assert_eq!(
            extract_first_error_code("warning: unused variable: `x`\n"),
            None
        );
    }

    #[test]
    fn truncate_tail_preserves_recent_bytes() {
        let s: String = (0..5000).map(|_| 'a').collect();
        let out = truncate_tail(&s, 100);
        assert!(out.starts_with("..."), "must mark the cut");
        assert!(out.contains("aaaa"), "tail must be retained");
        // 100 bytes of tail + the truncation marker line.
        assert!(out.len() <= 100 + 80, "out len = {}", out.len());
    }

    #[test]
    fn truncate_tail_noop_when_under_limit() {
        assert_eq!(truncate_tail("hi", 100), "hi");
    }

    #[test]
    fn render_demoted_failure_reason_emits_discriminator() {
        let preflight = BuildPreflight {
            ok: false,
            first_error_code: Some("E0432".to_string()),
            stderr_tail: String::new(),
            elapsed: Duration::from_secs(2),
            timed_out: false,
        };
        let reason = render_demoted_failure_reason(&preflight);
        assert!(reason.starts_with("build_preflight_failed:"));
        assert!(reason.contains("error[E0432]"));
        assert!(reason.contains("demoted task_completed to task_failed"));
    }

    #[test]
    fn render_demoted_failure_reason_handles_missing_code() {
        let preflight = BuildPreflight {
            ok: false,
            first_error_code: None,
            stderr_tail: String::new(),
            elapsed: Duration::from_secs(2),
            timed_out: false,
        };
        assert!(render_demoted_failure_reason(&preflight).contains("unknown"));
    }

    #[test]
    fn render_demoted_failure_reason_handles_timeout() {
        let preflight = BuildPreflight {
            ok: false,
            first_error_code: None,
            stderr_tail: String::new(),
            elapsed: Duration::from_secs(90),
            timed_out: true,
        };
        let reason = render_demoted_failure_reason(&preflight);
        assert!(reason.starts_with("build_preflight_failed:"));
        assert!(reason.contains("timeout after 90s"));
    }

    #[test]
    fn build_gate_enabled_reads_env_var() {
        let key = "AURA_BUILD_GATE";
        // Snapshot whatever the test environment has; restore at the
        // end so we don't pollute parallel tests in the same process.
        let original = std::env::var(key).ok();
        // SAFETY: env mutation is constrained to this test scope and
        // restored in the matching `set_var` call below.
        std::env::set_var(key, "1");
        assert!(build_gate_enabled());
        std::env::set_var(key, "yes");
        assert!(build_gate_enabled());
        std::env::set_var(key, "ON");
        assert!(build_gate_enabled());
        std::env::set_var(key, "false");
        assert!(!build_gate_enabled());
        std::env::set_var(key, "");
        assert!(!build_gate_enabled());
        std::env::remove_var(key);
        assert!(!build_gate_enabled());
        if let Some(value) = original {
            std::env::set_var(key, value);
        }
    }

    #[test]
    fn preflight_handles_non_cargo_workspace_as_skipped_ok() {
        let dir = tempfile::tempdir().unwrap();
        let result = run_build_preflight(dir.path().to_str().unwrap());
        assert!(result.ok, "non-cargo workspace must short-circuit as ok");
        assert!(result.stderr_tail.contains("not a Cargo workspace"));
    }

    #[test]
    fn preflight_rejects_empty_workspace_path() {
        let result = run_build_preflight("");
        assert!(!result.ok);
        assert!(result.stderr_tail.contains("workspace path is empty"));
    }

    #[test]
    fn preflight_rejects_missing_workspace_path() {
        let result = run_build_preflight("C:\\definitely-not-a-real-path-abc-xyz");
        assert!(!result.ok);
        assert!(result.stderr_tail.contains("does not exist on disk"));
    }
}
