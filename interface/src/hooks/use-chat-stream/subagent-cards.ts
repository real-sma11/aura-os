import type {
  CouncilMemberEntry,
  StreamRefs,
  StreamSetters,
  ToolCallEntry,
} from "../../shared/types/stream";
import type {
  SubagentSpawned,
  SubagentStatus,
} from "../../shared/types/harness-protocol";
import {
  closeCurrentThinkingSegment,
  nextTimelineId,
  syncDisplayedTimeline,
} from "../stream/handlers/shared";

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
 * Upsert one AURA Council member into the shared council parent entry's
 * `councilMembers`, keyed by `child_run_id` and ordered by
 * `council_index`. All members of a council turn share the SAME
 * `parent_tool_use_id`, so each spawn folds onto the one matched entry
 * rather than clobbering a single scalar `subagentRunId`. An existing
 * member's folded-in lifecycle `status` / `reason` are preserved across
 * a re-delivered spawn.
 */
function upsertCouncilMember(
  tc: ToolCallEntry,
  payload: SubagentSpawned,
  councilIndex: number,
): ToolCallEntry {
  const members = tc.councilMembers ? [...tc.councilMembers] : [];
  const existingIdx = members.findIndex(
    (m) => m.childRunId === payload.child_run_id,
  );
  const existing = existingIdx >= 0 ? members[existingIdx] : undefined;
  const member: CouncilMemberEntry = {
    childRunId: payload.child_run_id,
    model: payload.model ?? existing?.model,
    councilIndex,
    status: existing?.status ?? "running",
    reason: existing?.reason,
  };
  if (existingIdx >= 0) members[existingIdx] = member;
  else members.push(member);
  members.sort((a, b) => a.councilIndex - b.councilIndex);
  return {
    ...tc,
    councilMembers: members,
    subagentType: tc.subagentType ?? payload.subagent_type,
    subagentPrompt: tc.subagentPrompt ?? payload.prompt,
  };
}

/**
 * Ensure a parent tool-call entry exists for an AURA Council turn.
 *
 * Unlike an ordinary `task` spawn — whose parent card is created earlier
 * by the model's `task` tool call (`tool_use_start`) — a council run
 * fans members out directly with no preceding tool call, so there is no
 * entry for the shared `parent_tool_use_id` to fold onto. Synthesize one
 * (mirroring `handleToolCallStarted`) the first time a council member is
 * announced so the block registry can render the `CouncilPanel` and the
 * activity timeline shows the row. Subsequent members find this entry and
 * simply upsert.
 */
function ensureCouncilParentEntry(
  refs: StreamRefs,
  setters: StreamSetters,
  parentId: string,
): void {
  let exists = refs.toolCalls.current.some((tc) => tc.id === parentId);
  if (!exists) {
    setters.setEvents((prev) => {
      exists =
        exists ||
        prev.some((evt) => evt.toolCalls?.some((tc) => tc.id === parentId));
      return prev;
    });
  }
  if (exists) return;

  const entry: ToolCallEntry = {
    id: parentId,
    name: "Task",
    input: {},
    pending: true,
    started: true,
  };
  refs.toolCalls.current = [...refs.toolCalls.current, entry];
  setters.setActiveToolCalls([...refs.toolCalls.current]);

  const alreadyInTimeline = refs.timeline.current.some(
    (item) => item.kind === "tool" && item.toolCallId === parentId,
  );
  if (!alreadyInTimeline) {
    closeCurrentThinkingSegment(refs);
    refs.timeline.current.push({
      kind: "tool",
      toolCallId: parentId,
      id: nextTimelineId(),
    });
    syncDisplayedTimeline(refs, setters);
  }
}

/**
 * Handle a parent-stream `subagent_spawned` event.
 *
 * For an AURA Council member (`council_index` set), fold the member into
 * the shared council parent entry's `councilMembers` array (grouped by
 * the entry id == `parent_tool_use_id`) so the registry renders ONE
 * `CouncilPanel` with N live columns.
 *
 * For an ordinary `task` spawn, stamp the spawning card (matched by
 * `parent_tool_use_id`) with the child run id + type + prompt so the
 * `SubAgentBlock` can open its live thread.
 */
export function registerSpawnedSubagent(
  refs: StreamRefs,
  setters: StreamSetters,
  payload: SubagentSpawned,
): void {
  const parentId = payload.parent_tool_use_id;
  if (!parentId) return;
  const councilIndex = payload.council_index;
  if (councilIndex != null) {
    ensureCouncilParentEntry(refs, setters, parentId);
    patchToolCall(
      refs,
      setters,
      (tc) => tc.id === parentId,
      (tc) => upsertCouncilMember(tc, payload, councilIndex),
    );
    return;
  }
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

/** True when this entry carries a council member for the child run. */
function hasCouncilMember(tc: ToolCallEntry, childRunId: string): boolean {
  return tc.councilMembers?.some((m) => m.childRunId === childRunId) ?? false;
}

/**
 * Handle a parent-stream `subagent_status` event: fold the latest
 * lifecycle state (+ optional reason) into the card whose
 * `subagentRunId` matches the child run, OR into the matching AURA
 * Council member when the child run belongs to a council group.
 */
export function applySubagentStatus(
  refs: StreamRefs,
  setters: StreamSetters,
  payload: SubagentStatus,
): void {
  patchToolCall(
    refs,
    setters,
    (tc) =>
      tc.subagentRunId === payload.child_run_id ||
      hasCouncilMember(tc, payload.child_run_id),
    (tc) => {
      if (hasCouncilMember(tc, payload.child_run_id)) {
        return {
          ...tc,
          councilMembers: tc.councilMembers?.map((m) =>
            m.childRunId === payload.child_run_id
              ? {
                  ...m,
                  status: payload.state,
                  reason: payload.reason ?? m.reason,
                }
              : m,
          ),
        };
      }
      return {
        ...tc,
        subagentStatus: payload.state,
        subagentReason: payload.reason ?? tc.subagentReason,
      };
    },
  );
}
