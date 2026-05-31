import type {
  StreamRefs,
  StreamSetters,
  ToolCallEntry,
} from "../../shared/types/stream";
import type {
  SubagentSpawned,
  SubagentStatus,
} from "../../shared/types/harness-protocol";

/**
 * Apply `update` to every tool-call entry matching `match`, both in the
 * live `refs.toolCalls` array (driving the active streaming row) and in
 * any already-finalized `events` turn. Patching both lanes means a
 * `subagent_status` that lands after the parent turn's
 * `assistant_message_end` (subagents complete asynchronously) still
 * flips the historical card's pill.
 */
function patchToolCall(
  refs: StreamRefs,
  setters: StreamSetters,
  match: (tc: ToolCallEntry) => boolean,
  update: (tc: ToolCallEntry) => ToolCallEntry,
): void {
  let liveChanged = false;
  refs.toolCalls.current = refs.toolCalls.current.map((tc) => {
    if (!match(tc)) return tc;
    liveChanged = true;
    return update(tc);
  });
  if (liveChanged) setters.setActiveToolCalls([...refs.toolCalls.current]);

  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls) return evt;
      let evtChanged = false;
      const toolCalls = evt.toolCalls.map((tc) => {
        if (!match(tc)) return tc;
        evtChanged = true;
        return update(tc);
      });
      if (!evtChanged) return evt;
      changed = true;
      return { ...evt, toolCalls };
    });
    return changed ? next : prev;
  });
}

/**
 * Handle a parent-stream `subagent_spawned` event: stamp the spawning
 * `task` tool card (matched by `parent_tool_use_id`) with the child run
 * id + type + prompt so the `SubAgentBlock` can open its live thread.
 */
export function registerSpawnedSubagent(
  refs: StreamRefs,
  setters: StreamSetters,
  payload: SubagentSpawned,
): void {
  const parentId = payload.parent_tool_use_id;
  if (!parentId) return;
  patchToolCall(
    refs,
    setters,
    (tc) => tc.id === parentId,
    (tc) => ({
      ...tc,
      subagentRunId: payload.child_run_id,
      subagentType: tc.subagentType ?? payload.subagent_type,
      subagentPrompt: tc.subagentPrompt ?? payload.prompt,
      subagentStatus: tc.subagentStatus ?? "running",
    }),
  );
}

/**
 * Handle a parent-stream `subagent_status` event: fold the latest
 * lifecycle state (+ optional reason) into the card whose
 * `subagentRunId` matches the child run.
 */
export function applySubagentStatus(
  refs: StreamRefs,
  setters: StreamSetters,
  payload: SubagentStatus,
): void {
  patchToolCall(
    refs,
    setters,
    (tc) => tc.subagentRunId === payload.child_run_id,
    (tc) => ({
      ...tc,
      subagentStatus: payload.state,
      subagentReason: payload.reason ?? tc.subagentReason,
    }),
  );
}
