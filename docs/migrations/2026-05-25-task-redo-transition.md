# `tasks.status` `Done -> Ready` re-do edge

- Date: 2026-05-25
- Author: aura-os-server team
- Status: Proposed

Summary: open the storage-side `tasks.status` validator to accept the
`done -> ready` edge so users can "Re-do" a previously completed task
through `POST /api/projects/:project_id/tasks/:task_id/redo`. Pairs
with the matching aura-os-server change that wires the new endpoint
through [`safe_transition`](../../crates/aura-os-tasks/src/transition.rs)
and clears the persisted `attempts` counter.

## Motivation

Today aura-network's `validate_transition`
(`aura-storage/crates/domain/tasks/src/repo.rs`) treats `done` as a
terminal state — every outgoing edge returns 400. The failed-Retry
flow can recover a task from `failed` because `failed -> ready` is
allowed, but there is no symmetric way for a user to ask the
automation loop to re-run a task that already succeeded.

The new "Re-do" affordance in
[`interface/src/components/TaskMetaSection`](../../interface/src/components/TaskMetaSection/TaskMetaSection.tsx)
sits next to the existing failed-only Retry button and is shown only
when `effectiveStatus === "done"`. It calls a dedicated server
endpoint instead of overloading `retryTask`:

- Retry preserves `attempts` (the auto-retry budget guards against
  infinite re-runs of a still-broken task).
- Re-do is explicitly user-initiated, so it resets `attempts` to `0`
  and gets a fresh `MAX_TASK_ATTEMPTS` budget for the next run.

The aura-os-server side is implemented in
[`apps/aura-os-server/src/handlers/tasks/crud.rs`](../../apps/aura-os-server/src/handlers/tasks/crud.rs)
(see `redo_task`) and routed at
`POST /api/projects/:project_id/tasks/:task_id/redo`. The bridge
planner update lives in
[`crates/aura-os-tasks/src/transition.rs`](../../crates/aura-os-tasks/src/transition.rs)
and adds `(Done, Ready)` to the storage-allowed-edges const.

## Schema change

None. `tasks.status` is already a free-form string column constrained
by application logic, not a CHECK constraint, so the only change is
to the validator.

## Validator change — `aura-storage`

`aura-storage/crates/domain/tasks/src/repo.rs::validate_transition`
must add the new edge:

```rust
match (from, to) {
    // ... existing edges ...
    (TaskStatus::Failed,  TaskStatus::Ready) => Ok(()),
    (TaskStatus::Blocked, TaskStatus::Ready) => Ok(()),
    // User-initiated re-do. Reachable only through aura-os-server's
    // `POST /api/projects/:id/tasks/:id/redo` handler — the dev-loop
    // auto-retry ladder never targets `Done` so this does not let the
    // server resurrect completed tasks on its own.
    (TaskStatus::Done,    TaskStatus::Ready) => Ok(()),
    _ => Err(IllegalTransition { from, to }),
}
```

No write paths in aura-network change. The endpoint surface
(`POST /api/tasks/:id/transition` with `{"status":"ready"}`) already
exists; only the legality check loosens.

## API contract

No changes to existing endpoints. The new aura-os-server endpoint
`POST /api/projects/:project_id/tasks/:task_id/redo` is added as a
sibling of the existing `/retry`:

```jsonc
// Request: empty body, like /retry
POST /api/projects/proj-1/tasks/task-1/redo

// Response: the refreshed task row
{
  "task_id": "task-1",
  "status": "ready",
  "attempts": 0,
  // ... unchanged fields ...
}
```

The handler additionally issues a `PUT /api/tasks/:id` to aura-network
with `{"attempts": 0}` so the auto-retry budget is reset. That write
already lands through the
[2026-05-21 attempts column migration](2026-05-21-task-attempts-column.md).

## Rollout

1. Deploy the aura-network validator change. The new edge is
   strictly additive — every previously-legal transition still works,
   and `done -> ready` becomes a 200 instead of a 400.
2. Deploy aura-os-server with the new `redo_task` handler and the
   matching frontend Re-do button. If the validator change has not
   landed yet, the handler will surface the storage 400 to the UI as
   a `bad_request` toast (same pattern as today's `retry_task` when
   storage rejects an unexpected edge), so the order is forgiving.

## Rollback

The change is a strict superset of the previous validator. Reverting
the `validate_transition` change re-tightens `Done` back to terminal;
the redo button on the frontend will then 400 on click and the user
sees a "redoing task: illegal transition" toast. No data migration
required either way.
