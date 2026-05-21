# Persisted `tasks.attempts` column

- Date: 2026-05-21
- Author: aura-os-server team
- Status: Proposed

Summary: add a persisted `attempts INTEGER NOT NULL DEFAULT 0` column to the
aura-network `tasks` table so the dev-loop retry decision can stop
maintaining a parallel in-memory `TaskRetryTracker` and instead rely on a
single column that survives server restarts.

## Motivation

Phases 1–3 of the dev-loop simplification (`~/.cursor/plans/
simplify_dev-loop_harness_d6af7a5d.plan.md`) collapsed the harness-prose
classifier and completion-gate surface area down to a single
`HarnessFailureKind::is_retryable()` function. Phase 4 finishes the job by
deleting the parallel server-side retry state machine (the
`ToolRetryTracker` / `TaskRetryTracker` / `OrphanRecoveryPlan` family in
`aura-os-automation::resilience` and the `TOOL_CALL_RETRY_BUDGET` /
`TASK_LEVEL_RETRY_BUDGET` constants in `aura-os-automation::budget`).

The remaining piece of state we still need is "how many times has this
task already failed and been re-readied?". The pre-Phase-4 trackers
held that count in an `Arc<Mutex<HashMap<TaskId, u32>>>` keyed off the
loop forwarder. A server restart or loop kill silently reset the
counter to zero, so a permanently-broken task could re-burn its full
budget across restarts. Moving the count into the persisted task row
fixes that and removes ~400 lines of tracker / sweep / planner code.

## Schema change

Additive, defaulted, safe to deploy before writers flip.

```sql
ALTER TABLE tasks
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
```

Notes:

- `attempts` is a monotonic counter bumped by the dev-loop forwarder on
  every retryable `task_failed`. The server writes it through
  `PUT /api/tasks/:id` alongside the `Ready` transition; aura-network
  treats it as opaque persistence.
- `DEFAULT 0` keeps existing rows valid the moment the column lands.
  No backfill is required.
- The cap is enforced server-side (`MAX_TASK_ATTEMPTS = 3` in
  `apps/aura-os-server/src/handlers/dev_loop/streaming/side_effects/
  retry.rs`); aura-network does not need to know about the limit.

## API contract — `PUT /api/tasks/:id`

`UpdateTaskRequest` gains a new optional field:

```jsonc
{
  // ... existing fields ...
  "attempts": 1
}
```

When present, the value REPLACES the row's `attempts` column. The
dev-loop sends `attempts: task.attempts + 1` from
`maybe_apply_task_level_retry`. aura-network does no validation on the
value beyond the existing per-task-row write authorization.

`GET /api/tasks/:id` and `GET /api/projects/:id/tasks` include the
column in the response:

```jsonc
{
  // ... existing fields ...
  "attempts": 0
}
```

The aura-os-server-side `StorageTask::attempts` field is optional and
defaults to `0` so an aura-network instance that hasn't deployed the
column yet round-trips cleanly.

## Orphan-recovery sweep

In the same Phase, `recover_orphans` / `recover_failed` /
`OrphanRecoveryPlan` go away. The replacement is a single startup-time
loop in `apps/aura-os-server/src/handlers/dev_loop/adapter/start_loop.rs`
that lists tasks for the project and, for every task observed in
`InProgress`, issues `safe_transition(InProgress -> Ready)` so the
scheduler picks it up again. No budget gate at startup; the bump
happens in-loop on the next `task_failed`.

## Rollout

1. Deploy schema additive. The column defaults to `0`, existing
   writers and readers are unaffected.
2. Deploy aura-os-server with the new write path. The server now sets
   `attempts` on every retry hop; aura-network simply persists the
   value.
3. (Optional) Add an index on `attempts` if aura-network's reporting
   layer ever wants to query "tasks that have already been retried N
   times". Not required for Phase 4 itself.

## Rollback

The column is additive and defaulted. If Phase 4 needs to revert, drop
the column (`ALTER TABLE tasks DROP COLUMN attempts`); the server-side
retry path falls back to "every task retries up to `MAX_TASK_ATTEMPTS`
times per server lifetime", which is strictly no worse than the
pre-Phase-4 in-memory tracker.
