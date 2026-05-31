import type { BadgeVariant } from "@cypher-asi/zui";
import type { ToolCallEntry } from "../types/stream";
import type { SubagentState } from "../types/harness-protocol";

const SUBAGENT_STATES: readonly SubagentState[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "timeout",
  "rejected",
];

export function isSubagentState(value: unknown): value is SubagentState {
  return (
    typeof value === "string" &&
    (SUBAGENT_STATES as readonly string[]).includes(value)
  );
}

/**
 * Best-effort parse of a `task` tool result body into a subagent
 * lifecycle state. The harness returns the child run outcome as a JSON
 * string; we look for an `exit` / `state` / `status` field and narrow
 * it against {@link SubagentState}, also mapping a few common synonyms.
 * Returns `null` when nothing recognizable is found so callers can fall
 * back to the live `subagent_status` (or the tool's pending/error flags).
 */
export function parseSubagentExit(result: string): SubagentState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const raw = record.exit ?? record.state ?? record.status;
  if (typeof raw !== "string") return null;
  const normalized = raw.toLowerCase();
  if (isSubagentState(normalized)) return normalized;
  switch (normalized) {
    case "ok":
    case "success":
    case "succeeded":
    case "done":
      return "completed";
    case "error":
    case "errored":
      return "failed";
    default:
      return null;
  }
}

/**
 * Resolve the lifecycle state to render for a `task` tool card,
 * preferring the live `subagent_status`, then the parsed tool result,
 * then the tool's own pending/error flags.
 */
export function resolveSubagentState(entry: ToolCallEntry): SubagentState {
  if (entry.subagentStatus) return entry.subagentStatus;
  if (typeof entry.result === "string" && entry.result.length > 0) {
    const fromResult = parseSubagentExit(entry.result);
    if (fromResult) return fromResult;
  }
  if (entry.isError) return "failed";
  if (entry.pending) return "running";
  return "completed";
}

/** Map a subagent state onto a ZUI {@link BadgeVariant} for the pill. */
export function subagentBadgeVariant(state: SubagentState): BadgeVariant {
  switch (state) {
    case "running":
      return "running";
    case "failed":
    case "timeout":
    case "rejected":
      return "error";
    case "completed":
    case "cancelled":
      return "stopped";
    default:
      return "pending";
  }
}

/** Human-readable label for a subagent state. */
export function subagentStateLabel(state: SubagentState): string {
  switch (state) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "timeout":
      return "Timed out";
    case "rejected":
      return "Rejected";
    default:
      return state;
  }
}

/** Terminal (no longer streaming) states. */
export function isTerminalSubagentState(state: SubagentState): boolean {
  return state !== "running";
}
