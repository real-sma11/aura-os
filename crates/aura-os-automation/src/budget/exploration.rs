//! Soft / hard exploration budget scaled to task complexity.
//!
//! Phase G4a / Section F5. The harness today exposes a fixed
//! "STRONG WARNING" block after a handful of read-only tool calls
//! regardless of how big the task is — small bug-fixes and large
//! refactors share the same ~18-call ceiling, which calibrates the
//! agent toward rushing implementation on the genuinely large
//! tasks. This module owns the pure scaling policy: a soft ceiling
//! the agent should treat as advisory, and a hard ceiling beyond
//! which the warning escalates to "make progress now or hand back
//! to the loop".
//!
//! ## Heuristic
//!
//! Soft ceiling scales linearly with the task's complexity:
//!
//! ```text
//! soft = clamp(
//!     EXPLORATION_SOFT_FLOOR
//!         + (description_len / 200)
//!         + (dependency_count * 2),
//!     EXPLORATION_SOFT_FLOOR,
//!     EXPLORATION_SOFT_CEILING,
//! );
//! hard = soft * EXPLORATION_HARD_MULTIPLIER;
//! ```
//!
//! The constants are deliberate:
//!
//! * `EXPLORATION_SOFT_FLOOR = 20` gives even small tasks enough
//!   room to read the task spec, inspect surrounding modules, and
//!   check tests before the first nudge appears.
//! * `EXPLORATION_SOFT_CEILING = 96` keeps the cap finite while
//!   allowing genuinely cross-crate work to gather enough context
//!   before implementation.
//! * `hard = soft * 4` keeps the "let it cook" band wide enough for
//!   discovery, implementation, and verification reads.
//! * `EXPLORATION_HARD_FLOOR = 80` (== floor × 4) is the published
//!   minimum hard ceiling. We do not surface a separate
//!   `for_task` clamp on `hard` because `soft` is already
//!   clamped, so `hard = soft * EXPLORATION_HARD_MULTIPLIER` is
//!   automatically bounded by `[EXPLORATION_HARD_FLOOR,
//!   EXPLORATION_SOFT_CEILING * EXPLORATION_HARD_MULTIPLIER]`.

/// Minimum soft ceiling. A task with no description and no
/// dependencies still gets this many "free" exploration calls
/// before the soft advisory triggers. Sized so the agent can
/// read the task spec, list the relevant directory, and skim a
/// a meaningful slice of the codebase before being nudged.
pub const EXPLORATION_SOFT_FLOOR: u32 = 20;

/// Maximum soft ceiling. Caps the heuristic so a pathologically
/// large description / dependency list does not produce a soft
/// budget that exceeds the harness's per-turn capacity.
pub const EXPLORATION_SOFT_CEILING: u32 = 96;

/// Hard-ceiling multiplier applied to the scaled soft budget. This is
/// deliberately generous so warnings stay advisory while agents work
/// through larger multi-file tasks.
pub const EXPLORATION_HARD_MULTIPLIER: u32 = 4;

/// Minimum hard ceiling. Equals [`EXPLORATION_SOFT_FLOOR`] times
/// [`EXPLORATION_HARD_MULTIPLIER`] so
/// the smallest possible soft budget still has a non-trivial
/// `hard` band beyond it for genuine multi-file investigations.
pub const EXPLORATION_HARD_FLOOR: u32 = EXPLORATION_SOFT_FLOOR * EXPLORATION_HARD_MULTIPLIER;

/// Per-`description_len` characters of "extra" soft budget. Tuned
/// so a 200-character spec line earns one additional call, a 1 KB
/// description earns five, etc. Chosen by inspection of a handful
/// of healthy dev-loop traces — the model rarely benefits from
/// more than ~30 read-only calls before its hand needs to be on
/// the implementation.
pub const EXPLORATION_DESCRIPTION_DIVISOR: usize = 200;

/// Per-dependency soft-budget bonus. Each parent / child task in
/// the resolved [`super::super::task_context::TaskContext`] earns
/// the agent two extra exploration calls — typically one
/// `get_task_context` and one targeted `read_file` per neighbour
/// to load relevant prior work.
pub const EXPLORATION_DEPENDENCY_BONUS: u32 = 2;

/// Soft / hard exploration ceilings for a single task.
///
/// `Copy` so the value can be embedded in per-turn prompt build
/// context without lifetime ceremony. Both fields are public so
/// the server-side prompt-template wiring can format them into a
/// header without going through accessors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExplorationBudget {
    /// Soft advisory threshold. Once `used >= soft` the agent is
    /// nudged to consider proposing an edit / running a
    /// verification command, but reads are not blocked.
    pub soft: u32,
    /// Hard escalation threshold. Once `used > hard` the agent is
    /// told to make progress now or hand back to the loop with a
    /// status update. Still advisory, never a structural block —
    /// the harness keeps any tool call the model issues, but the
    /// per-turn header escalates the framing.
    pub hard: u32,
}

/// Three-way classification of an in-flight exploration call
/// count. The server's prompt builder picks the matching advisory
/// header from this verdict.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum ExplorationStatus {
    /// `used` is strictly below `soft`. No advisory; the default
    /// "you have plenty of budget left" framing applies.
    WithinBudget,
    /// `used` is in `[soft, hard]`. The advisory tone applies:
    /// "you've used N of your soft budget; continue if you need
    /// to".
    WithinSoftAdvisory,
    /// `used` is strictly above `hard`. The escalated tone
    /// applies: "exceeded the hard ceiling; make progress or
    /// hand back".
    OverHard,
}

impl ExplorationBudget {
    /// Classify a `used` count, but route the verdict through the
    /// `unique` count when the caller is tracking content-hash
    /// dedupe.
    ///
    /// The harness's read tool stamps a `content_hash` onto every
    /// `read_file` result. Each time the agent loop bumps the
    /// per-task exploration counter it ALSO inspects the prior
    /// hashes and increments a separate `unique` counter only when
    /// the new read returned bytes it hadn't seen for this task
    /// before. Passing both into [`Self::classify_with_cache`]
    /// keeps the soft/hard advisory grounded in genuinely-new
    /// reads, so a tight loop re-reading the same file doesn't
    /// trip the budget the way it did in the prior zero-crypto
    /// run.
    ///
    /// `used` is still propagated into the message
    /// ([`Self::advisory_text_with_cache`]) so the operator can see
    /// the wasted-read count, but the classification itself uses
    /// `unique` so a cached re-read is effectively free.
    #[must_use]
    pub fn classify_with_cache(self, _used: u32, unique: u32) -> ExplorationStatus {
        self.classify(unique)
    }

    /// Render the per-turn advisory header text against a
    /// cache-aware `(used, unique)` pair. Mirrors
    /// [`Self::advisory_text`] but the message includes both numbers
    /// so the agent sees how much of its budget is being burned on
    /// cached re-reads. Returns `None` while `unique` is still under
    /// the soft floor, matching the no-warning baseline.
    #[must_use]
    pub fn advisory_text_with_cache(self, used: u32, unique: u32) -> Option<String> {
        match self.classify(unique) {
            ExplorationStatus::WithinBudget => None,
            ExplorationStatus::WithinSoftAdvisory => Some(format!(
                "Heads up: {used} reads/searches issued ({unique} unique) against \
                 a soft ceiling of {soft}. Cached re-reads are free; consider \
                 proposing an edit or running a verification command before \
                 issuing more reads of files you've already seen.",
                soft = self.soft,
            )),
            ExplorationStatus::OverHard => Some(format!(
                "Exploration budget exceeded ({used} reads issued, {unique} unique, \
                 hard ceiling {hard}). Start turning the gathered context into an \
                 edit, a build/test command, or a concise status update.",
                hard = self.hard,
            )),
        }
    }

    /// Scale a soft / hard pair from the task's
    /// `description_len` (characters) and `dependency_count`
    /// (parent + children). See the module doc for the formula.
    ///
    /// Returns ceilings clamped into
    /// `[EXPLORATION_SOFT_FLOOR, EXPLORATION_SOFT_CEILING]` for
    /// `soft`. `hard` is computed as
    /// `soft * EXPLORATION_HARD_MULTIPLIER` — automatically
    /// bounded by the soft clamp so it never grows without
    /// bound.
    #[must_use]
    pub fn for_task(description_len: usize, dependency_count: usize) -> Self {
        let description_bonus = u32::try_from(
            description_len
                .checked_div(EXPLORATION_DESCRIPTION_DIVISOR)
                .unwrap_or(0),
        )
        .unwrap_or(u32::MAX);
        let dependency_bonus = u32::try_from(dependency_count)
            .unwrap_or(u32::MAX)
            .saturating_mul(EXPLORATION_DEPENDENCY_BONUS);
        let raw_soft = EXPLORATION_SOFT_FLOOR
            .saturating_add(description_bonus)
            .saturating_add(dependency_bonus);
        let soft = raw_soft.clamp(EXPLORATION_SOFT_FLOOR, EXPLORATION_SOFT_CEILING);
        Self {
            soft,
            hard: soft.saturating_mul(EXPLORATION_HARD_MULTIPLIER),
        }
    }

    /// Classify a `used` exploration count against this budget.
    /// `used == soft` is treated as the start of the soft
    /// advisory band so the agent gets the heads-up exactly when
    /// it crosses the threshold.
    #[must_use]
    pub fn classify(self, used: u32) -> ExplorationStatus {
        if used > self.hard {
            ExplorationStatus::OverHard
        } else if used >= self.soft {
            ExplorationStatus::WithinSoftAdvisory
        } else {
            ExplorationStatus::WithinBudget
        }
    }

    /// Render the per-turn advisory header text for `used`. The
    /// caller embeds the returned string into the dev-loop's
    /// system prompt so the harness forwards it on every turn.
    /// Returns `None` for [`ExplorationStatus::WithinBudget`] so
    /// the caller can omit the header entirely until the agent
    /// crosses the soft threshold.
    ///
    /// The strings are deliberately advisory: no `STRONG WARNING:`
    /// prefix, no language that asserts the agent will be blocked.
    #[must_use]
    pub fn advisory_text(self, used: u32) -> Option<String> {
        match self.classify(used) {
            ExplorationStatus::WithinBudget => None,
            ExplorationStatus::WithinSoftAdvisory => Some(format!(
                "Heads up: you've used {used} of your ~{soft} soft exploration \
                 budget for this task. Continue if you genuinely need more \
                 reads/searches; otherwise consider proposing an edit or \
                 running a verification command.",
                soft = self.soft,
            )),
            ExplorationStatus::OverHard => Some(format!(
                "Exploration budget exceeded ({used} reads/searches against a \
                 hard ceiling of {hard}). Start turning the gathered context \
                 into an edit, a build/test command, or a concise status update.",
                hard = self.hard,
            )),
        }
    }

    /// Render the per-turn advisory header text with awareness of the
    /// task's baseline [`WorkspaceHealth`].
    ///
    /// Phase 2 of `workspace-health-diff-gate`. The pre-existing
    /// [`Self::advisory_text_with_cache`] only fires after the agent
    /// crosses the soft floor and frames the nudge in terms of
    /// exploration count. That's too late and too generic for the
    /// Task-3.7 abort shape: the agent burned its whole budget
    /// exploring without ever being told the workspace was already
    /// red in `crates/zero-storage`. This method threads the baseline
    /// health snapshot through so the per-turn header names the
    /// broken crate from turn 1, even when `used` is still well
    /// inside the soft budget.
    ///
    /// Behaviour:
    ///
    /// * `health` is `None` or `Passing`: delegate verbatim to
    ///   [`Self::advisory_text_with_cache`], so the existing
    ///   baseline-clean behaviour is preserved.
    /// * `health` is `Failing`:
    ///   * Build a scope-aware health summary via
    ///     [`format_health_summary`], prefixed with the
    ///     intersects-scope or outside-scope framing depending on
    ///     whether the supplied `scope` hits any baseline error
    ///     file/crate.
    ///   * When the exploration count is still
    ///     [`ExplorationStatus::WithinBudget`], the header is just
    ///     the health summary — the agent needs to know about the
    ///     red on turn 1.
    ///   * When in the soft or over-hard band, the existing
    ///     exploration advisory text is appended after a ` || `
    ///     separator so both nudges land in the same header.
    #[must_use]
    pub fn advisory_text_with_health(
        self,
        used: u32,
        unique: u32,
        health: Option<&crate::health::WorkspaceHealth>,
        scope: Option<&crate::health::TaskScope>,
    ) -> Option<String> {
        let Some(health) = health else {
            return self.advisory_text_with_cache(used, unique);
        };
        if !matches!(
            health.build_status,
            crate::health::BuildStatus::Failing { .. }
        ) {
            return self.advisory_text_with_cache(used, unique);
        }

        let prefix = scope_prefix(health, scope);
        let summary = format_health_summary(health, scope);
        let header = format!("{prefix}{summary}");

        match self.classify_with_cache(used, unique) {
            ExplorationStatus::WithinBudget => Some(header),
            ExplorationStatus::WithinSoftAdvisory | ExplorationStatus::OverHard => {
                let exploration = self
                    .advisory_text_with_cache(used, unique)
                    .unwrap_or_default();
                Some(format!("{header} || {exploration}"))
            }
        }
    }

    /// Sibling of [`Self::advisory_text_with_health`] for callers
    /// that don't separately track unique-read counts. Simply
    /// forwards `used` as both `used` and `unique`.
    #[must_use]
    pub fn advisory_text_with_health_no_cache(
        self,
        used: u32,
        health: Option<&crate::health::WorkspaceHealth>,
        scope: Option<&crate::health::TaskScope>,
    ) -> Option<String> {
        self.advisory_text_with_health(used, used, health, scope)
    }
}

/// Build the scope-aware preamble that precedes a health summary
/// when the baseline workspace is failing.
fn scope_prefix(
    health: &crate::health::WorkspaceHealth,
    scope: Option<&crate::health::TaskScope>,
) -> &'static str {
    if let Some(scope) = scope {
        if !scope.is_empty() && scope.intersects_errors(health.errors()) {
            return "your task scope intersects the broken area \u{2014} fix as part of this task; ";
        }
    }
    "workspace is broken outside your task scope; if your task description targets unrelated \
     files you may continue, but the loop will surface this red at task_done; "
}

/// Build a short, deterministic summary of the baseline error set.
///
/// Format (verbatim from the plan):
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
/// * `scope` is accepted for symmetry with the wrapper and to keep
///   the door open for scope-prioritized ordering later; the Phase 2
///   surface intentionally ignores it so the summary stays a stable
///   deterministic fragment.
#[must_use]
pub fn format_health_summary(
    health: &crate::health::WorkspaceHealth,
    _scope: Option<&crate::health::TaskScope>,
) -> String {
    use std::collections::BTreeMap;

    let errors = health.errors();
    let total_errors = errors.len();

    let mut by_file: BTreeMap<&str, Vec<&crate::health::HealthError>> = BTreeMap::new();
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

impl Default for ExplorationBudget {
    /// Default budget is the floor pair — useful for tests and
    /// for the "no task scoped" path where the caller has no
    /// description / dependency signal.
    fn default() -> Self {
        Self {
            soft: EXPLORATION_SOFT_FLOOR,
            hard: EXPLORATION_HARD_FLOOR,
        }
    }
}
