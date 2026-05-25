//! Replay-based integration tests for the autonomous recovery pipeline.
//!
//! The submodules each focus on one slice of the pipeline:
//!
//! * `bundle` — synthesises a run bundle on disk and asserts the
//!   `aura-run-heuristics` analyzer surfaces the expected
//!   `SplitWriteIntoSkeletonPlusAppends` finding.
//! * `classifiers` — tests for the failure-class detectors used by
//!   the retry ladder.
//! * `gates` — completion / recovery / restart gate decision tests.
//! * `agent_stuck` — terminal "agent stuck" anti-waste signal.
//! * `preflight` — preflight detector for the canonical
//!   "generate the full implementation of …" description.

pub(crate) const PROJECT_ID: &str = "11111111-1111-4111-8111-111111111111";
pub(crate) const AGENT_INSTANCE_ID: &str = "22222222-2222-4222-8222-222222222222";
pub(crate) const TASK_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
pub(crate) const RUN_ID: &str = "20240101_000000_replay";

/// Path the simulated run kept trying to write. The concrete value
/// matters — the heuristic pipeline surfaces it verbatim as the
/// remediation target.
pub(crate) const BLOCKED_PATH: &str = "crates/foo/src/bar.rs";

mod agent_stuck;
mod bundle;
mod classifiers;
mod gates;
mod preflight;
