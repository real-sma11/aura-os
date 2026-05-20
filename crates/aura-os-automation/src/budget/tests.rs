//! Unit tests for [`super::exploration`].

use super::exploration::{
    ExplorationBudget, ExplorationStatus, EXPLORATION_HARD_FLOOR, EXPLORATION_HARD_MULTIPLIER,
    EXPLORATION_SOFT_CEILING, EXPLORATION_SOFT_FLOOR,
};

#[test]
fn empty_task_falls_back_to_floor() {
    let budget = ExplorationBudget::for_task(0, 0);
    assert_eq!(
        budget.soft, EXPLORATION_SOFT_FLOOR,
        "an empty task must still receive the soft floor",
    );
    assert_eq!(
        budget.hard, EXPLORATION_HARD_FLOOR,
        "an empty task's hard ceiling must equal the published hard floor",
    );
}

#[test]
fn description_length_inflates_soft_budget_linearly() {
    let small = ExplorationBudget::for_task(0, 0);
    let larger = ExplorationBudget::for_task(600, 0);
    assert!(
        larger.soft > small.soft,
        "longer descriptions must earn extra soft budget; got soft={} vs {}",
        larger.soft,
        small.soft,
    );
    assert_eq!(
        larger.soft,
        EXPLORATION_SOFT_FLOOR + 3,
        "600 chars / 200 = 3 bonus calls",
    );
    assert_eq!(
        larger.hard,
        larger.soft * EXPLORATION_HARD_MULTIPLIER,
        "hard must remain `soft * EXPLORATION_HARD_MULTIPLIER` after scaling",
    );
}

#[test]
fn dependencies_inflate_soft_budget_with_constant_bonus() {
    let no_deps = ExplorationBudget::for_task(0, 0);
    let with_deps = ExplorationBudget::for_task(0, 4);
    assert_eq!(
        with_deps.soft,
        no_deps.soft + 4 * 2,
        "each dependency must earn EXPLORATION_DEPENDENCY_BONUS extra calls",
    );
}

#[test]
fn huge_inputs_clamp_at_soft_ceiling() {
    let budget = ExplorationBudget::for_task(1_000_000, 1_000);
    assert_eq!(
        budget.soft, EXPLORATION_SOFT_CEILING,
        "absurd inputs must clamp at EXPLORATION_SOFT_CEILING",
    );
    assert_eq!(
        budget.hard,
        EXPLORATION_SOFT_CEILING * EXPLORATION_HARD_MULTIPLIER,
        "hard must follow the clamped soft value",
    );
}

#[test]
fn classify_returns_each_variant() {
    let budget = ExplorationBudget::for_task(0, 0);
    assert_eq!(budget.classify(0), ExplorationStatus::WithinBudget);
    assert_eq!(
        budget.classify(budget.soft - 1),
        ExplorationStatus::WithinBudget,
        "one below soft is still WithinBudget",
    );
    assert_eq!(
        budget.classify(budget.soft),
        ExplorationStatus::WithinSoftAdvisory,
        "exact soft hit must trigger the advisory band",
    );
    assert_eq!(
        budget.classify(budget.hard),
        ExplorationStatus::WithinSoftAdvisory,
        "exact hard hit is still inside the advisory band; OverHard is `> hard`",
    );
    assert_eq!(
        budget.classify(budget.hard + 1),
        ExplorationStatus::OverHard,
    );
    assert_eq!(budget.classify(u32::MAX), ExplorationStatus::OverHard);
}

#[test]
fn advisory_text_is_silent_within_budget() {
    let budget = ExplorationBudget::for_task(0, 0);
    assert!(budget.advisory_text(0).is_none());
    assert!(budget
        .advisory_text(budget.soft.saturating_sub(1))
        .is_none());
}

#[test]
fn advisory_text_uses_soft_framing_inside_advisory_band() {
    let budget = ExplorationBudget::for_task(0, 0);
    let text = budget
        .advisory_text(budget.soft)
        .expect("soft band must produce advisory text");
    assert!(
        text.starts_with("Heads up:"),
        "soft advisory must start with the heads-up framing, got: {text}",
    );
    assert!(
        text.contains(&format!("~{}", budget.soft)),
        "advisory must name the soft ceiling so the agent knows the threshold: {text}",
    );
    assert!(
        !text.contains("STRONG WARNING"),
        "soft advisory must not use the deprecated STRONG WARNING framing: {text}",
    );
}

#[test]
fn advisory_text_uses_escalation_framing_over_hard() {
    let budget = ExplorationBudget::for_task(0, 0);
    let text = budget
        .advisory_text(budget.hard + 1)
        .expect("over-hard band must produce advisory text");
    assert!(
        text.starts_with("Exploration budget exceeded"),
        "over-hard advisory must lead with the budget-exceeded framing: {text}",
    );
    assert!(
        text.contains(&format!("hard ceiling of {}", budget.hard)),
        "advisory must name the hard ceiling: {text}",
    );
    assert!(
        !text.contains("STRONG WARNING"),
        "over-hard advisory must not use the deprecated STRONG WARNING framing: {text}",
    );
    assert!(
        !text.to_lowercase().contains("blocked"),
        "advisory must not threaten to block the agent's reads: {text}",
    );
}

#[test]
fn default_matches_floor_pair() {
    let default_budget = ExplorationBudget::default();
    assert_eq!(default_budget.soft, EXPLORATION_SOFT_FLOOR);
    assert_eq!(default_budget.hard, EXPLORATION_HARD_FLOOR);
}

#[test]
fn classify_with_cache_uses_unique_count_not_used() {
    let budget = ExplorationBudget::for_task(0, 0);
    // Far over the hard ceiling on raw count, but every read was a
    // cached re-read so unique stays low → still within budget.
    assert_eq!(
        budget.classify_with_cache(budget.hard * 4, 0),
        ExplorationStatus::WithinBudget,
        "cache-aware classify must ignore raw `used` when `unique` is low",
    );
    // Unique high → escalation fires regardless of how low `used` was.
    assert_eq!(
        budget.classify_with_cache(1, budget.hard + 5),
        ExplorationStatus::OverHard,
    );
}

#[test]
fn advisory_text_with_cache_mentions_both_numbers() {
    let budget = ExplorationBudget::for_task(0, 0);
    let text = budget
        .advisory_text_with_cache(budget.soft * 2, budget.soft)
        .expect("soft band with cache info must produce advisory text");
    assert!(text.contains(&format!("{}", budget.soft * 2)), "{text}");
    assert!(text.contains(&format!("{} unique", budget.soft)), "{text}");
    assert!(text.contains("Cached re-reads are free"), "{text}");
}

#[test]
fn advisory_text_with_cache_silent_when_unique_within_budget() {
    let budget = ExplorationBudget::for_task(0, 0);
    // Even if the agent issued many reads, if none added unique bytes
    // we stay silent — the budget is about novel info acquisition.
    assert!(budget
        .advisory_text_with_cache(budget.hard, budget.soft - 1)
        .is_none());
}

// ---------------------------------------------------------------------------
// Phase 2 of `workspace-health-diff-gate`: advisory_text_with_health{,_no_cache}
// ---------------------------------------------------------------------------

use super::exploration::format_health_summary;
use crate::health::{extract_task_scope, HealthError, TaskScope, WorkspaceHealth};

fn mk_err(file: &str, code: Option<&str>, kind: &str) -> HealthError {
    HealthError {
        file: file.to_owned(),
        code: code.map(str::to_owned),
        kind: kind.to_owned(),
    }
}

fn red_workspace() -> WorkspaceHealth {
    WorkspaceHealth::failing(vec![
        mk_err(
            "crates/zero-storage/src/key.rs",
            Some("E0277"),
            "trait bound",
        ),
        mk_err(
            "crates/zero-storage/src/key.rs",
            Some("E0277"),
            "trait bound",
        ),
        mk_err(
            "crates/zero-storage/src/blob.rs",
            Some("E0432"),
            "unresolved import",
        ),
        mk_err(
            "crates/zero-identity/src/lib.rs",
            Some("E0425"),
            "unresolved name",
        ),
    ])
}

#[test]
fn advisory_text_with_health_returns_none_when_baseline_clean_and_within_budget() {
    let budget = ExplorationBudget::for_task(0, 0);
    let baseline = WorkspaceHealth::clean();
    assert!(budget
        .advisory_text_with_health(0, 0, Some(&baseline), None)
        .is_none());
}

#[test]
fn advisory_text_with_health_delegates_to_cache_aware_when_baseline_none() {
    let budget = ExplorationBudget::for_task(0, 0);
    // Sample several points across the cache-aware classification
    // bands; each must round-trip verbatim through the health-aware
    // wrapper when no baseline is supplied.
    let cases = [
        (0u32, 0u32),
        (budget.soft, budget.soft),
        (budget.soft * 2, budget.soft),
        (budget.hard + 5, budget.hard + 5),
    ];
    for (used, unique) in cases {
        assert_eq!(
            budget.advisory_text_with_health(used, unique, None, None),
            budget.advisory_text_with_cache(used, unique),
            "(used={used}, unique={unique}) must delegate verbatim when baseline is absent",
        );
    }
}

#[test]
fn advisory_text_with_health_emits_health_summary_within_budget_when_baseline_red() {
    let budget = ExplorationBudget::for_task(0, 0);
    let baseline = red_workspace();
    let header = budget
        .advisory_text_with_health(0, 0, Some(&baseline), None)
        .expect("baseline red must surface a header even on turn 1");
    assert!(
        header.contains("workspace red at task start"),
        "header must lead with the workspace-red framing: {header}",
    );
    assert!(
        header.contains("crates/zero-storage"),
        "header must name the broken crate so the agent has a concrete target: {header}",
    );
    assert!(
        !header.contains(" || "),
        "within-budget header must NOT carry the exploration-advisory suffix: {header}",
    );
    assert!(
        !header.starts_with("Heads up:") && !header.contains("Exploration budget exceeded"),
        "within-budget header must omit the soft / over-hard framing entirely: {header}",
    );
}

#[test]
fn advisory_text_with_health_prefixes_scope_intersects_message_when_scope_hits_red_file() {
    let budget = ExplorationBudget::for_task(0, 0);
    let baseline = red_workspace();
    let scope = extract_task_scope("Fix crates/zero-storage red surface.", &[]);
    let header = budget
        .advisory_text_with_health(0, 0, Some(&baseline), Some(&scope))
        .expect("scope-intersecting red must produce a header");
    assert!(
        header.starts_with(
            "your task scope intersects the broken area \u{2014} fix as part of this task;"
        ),
        "intersecting-scope header must lead with the fix-as-part-of-this-task framing: {header}",
    );
}

#[test]
fn advisory_text_with_health_prefixes_outside_scope_message_when_scope_misses_red() {
    let budget = ExplorationBudget::for_task(0, 0);
    let baseline = red_workspace();
    let scope = extract_task_scope("Update README.md only.", &[]);
    let header = budget
        .advisory_text_with_health(0, 0, Some(&baseline), Some(&scope))
        .expect("non-intersecting scope still produces a header for the agent");
    assert!(
        header.starts_with("workspace is broken outside your task scope;"),
        "outside-scope header must lead with the outside-scope framing: {header}",
    );
    assert!(
        header.contains("surface this red at task_done"),
        "outside-scope header must remind the agent that task_done will surface the red: {header}",
    );
}

#[test]
fn advisory_text_with_health_appends_existing_exploration_advisory_after_soft_threshold() {
    let budget = ExplorationBudget::for_task(0, 0);
    let baseline = red_workspace();
    let used = budget.soft;
    let header = budget
        .advisory_text_with_health(used, used, Some(&baseline), None)
        .expect("soft-band crossing with red baseline must produce a header");
    assert!(
        header.contains("workspace red at task start"),
        "header must still lead with the health summary: {header}",
    );
    let exploration = budget
        .advisory_text_with_cache(used, used)
        .expect("exploration advisory should fire at the soft floor");
    assert!(
        header.contains(" || "),
        "soft-band header must separate health + exploration via ` || `: {header}",
    );
    assert!(
        header.ends_with(&exploration),
        "soft-band header must end with the verbatim cache-aware exploration advisory: \
         header={header} exploration={exploration}",
    );
}

#[test]
fn format_health_summary_orders_files_lexicographically_and_clamps_to_three() {
    let health = WorkspaceHealth::failing(vec![
        mk_err("crates/zzz-last/src/lib.rs", Some("E0001"), "k"),
        mk_err("crates/bbb-second/src/lib.rs", Some("E0002"), "k"),
        mk_err("crates/aaa-first/src/lib.rs", Some("E0003"), "k"),
        mk_err("crates/ddd-fourth/src/lib.rs", Some("E0004"), "k"),
        mk_err("crates/ccc-third/src/lib.rs", Some("E0005"), "k"),
    ]);
    let summary = format_health_summary(&health, None);
    // Lex-first three crates must appear; the two later ones must not.
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
    // Lex ordering must be reflected in the listing order.
    let aaa = summary.find("crates/aaa-first").unwrap();
    let bbb = summary.find("crates/bbb-second").unwrap();
    let ccc = summary.find("crates/ccc-third").unwrap();
    assert!(
        aaa < bbb && bbb < ccc,
        "files must appear in lex order: {summary}"
    );
}

#[test]
fn format_health_summary_uses_unicode_multiplication_sign_for_repeated_error_codes() {
    let health = WorkspaceHealth::failing(vec![
        mk_err("crates/zero-storage/src/key.rs", Some("E0277"), "k"),
        mk_err("crates/zero-storage/src/key.rs", Some("E0277"), "k"),
        mk_err("crates/zero-storage/src/key.rs", Some("E0432"), "k"),
    ]);
    let summary = format_health_summary(&health, None);
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

#[test]
fn advisory_text_with_health_no_cache_matches_with_cache_when_used_equals_unique() {
    let budget = ExplorationBudget::for_task(0, 0);
    let baseline = red_workspace();
    let scope: Option<&TaskScope> = None;
    let samples = [0u32, budget.soft, budget.soft * 2, budget.hard + 3];
    for used in samples {
        assert_eq!(
            budget.advisory_text_with_health_no_cache(used, Some(&baseline), scope),
            budget.advisory_text_with_health(used, used, Some(&baseline), scope),
            "no_cache must collapse to with_cache(used, used) at used={used}",
        );
    }
    // And it must also match for the baseline=None delegation path.
    for used in samples {
        assert_eq!(
            budget.advisory_text_with_health_no_cache(used, None, None),
            budget.advisory_text_with_cache(used, used),
            "no_cache + baseline=None must delegate to advisory_text_with_cache at used={used}",
        );
    }
}
