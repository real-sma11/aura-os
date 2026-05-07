import type { Session } from "../../shared/types";
import { getDateBucket } from "../../apps/agents/AgentInfoPanel/agent-info-utils";

/**
 * A `Session` enriched with the project + agent-instance identifiers
 * needed to navigate the main chat view to the right route. The agents
 * shell additionally surfaces a friendly project name for tooltips.
 *
 * - Agents app: filled in from the agent's project bindings.
 * - Projects app: filled in from the session row itself
 *   (`api.listProjectSessions` returns sessions across every agent
 *   instance in the project; we mirror those fields onto the underscored
 *   keys to keep one shape for the shared row component).
 */
export type AnnotatedSession = Session & {
  _projectName: string;
  _projectId: string;
  _agentInstanceId: string;
};

/**
 * Strip the markdown decoration the Haiku summarizer occasionally
 * leaves on the first line of a session summary — `# Session Summary`,
 * `**Title**`, `- item`, `> quote`, `1. step`, etc. Run per-line so
 * the first line that still has visible content after stripping wins,
 * matching the way users actually scan the sidekick.
 *
 * Existing persisted summaries already carry these prefixes (see the
 * Haiku prompt in `apps/aura-os-server/src/handlers/agents/sessions.rs`),
 * so this clean-up has to happen at render time even after the
 * backend prompt is tightened.
 */
function stripLeadingMarkdown(line: string): string {
  let out = line.trim();
  // Heading markers (`#`, `##`, …) and ATX trailing hashes.
  // The trailing `(\s+|$)` lets a bare `#` line collapse to empty
  // so the per-line walk in `truncate` skips to the next visible
  // line instead of returning `#`.
  out = out.replace(/^#{1,6}(\s+|$)/, "").replace(/\s+#+\s*$/, "");
  // Blockquote, unordered list, ordered list markers.
  out = out.replace(/^>+\s+/, "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
  // Strip wrapping bold / italic / code (`**Title**`, `__Title__`,
  // `*Title*`, `_Title_`, `\`Title\``). Only when the whole line is
  // wrapped — partial markup inside the title is left alone.
  out = out.replace(/^\*\*(.+?)\*\*$/, "$1")
    .replace(/^__(.+?)__$/, "$1")
    .replace(/^\*(.+?)\*$/, "$1")
    .replace(/^_(.+?)_$/, "$1")
    .replace(/^`(.+?)`$/, "$1");
  return out.trim();
}

export function truncate(text: string, max: number): string {
  // Walk lines until we find one with visible content after the
  // markdown strip. Falls back to the raw first line so we never
  // return an empty label for a non-empty summary.
  const lines = text.split("\n");
  let chosen = "";
  for (const line of lines) {
    const cleaned = stripLeadingMarkdown(line);
    if (cleaned.length > 0) {
      chosen = cleaned;
      break;
    }
  }
  if (!chosen) {
    chosen = lines[0]?.trim() ?? "";
  }
  if (chosen.length <= max) return chosen;
  return `${chosen.slice(0, max - 1)}…`;
}

/**
 * Placeholder label rendered while the Haiku summarizer is still
 * generating a real summary for a brand-new session. `useSessionSummaries`
 * fires `summarizeSession` per session-without-summary on mount and
 * upgrades the label in place once the response lands. Exported so
 * tests and downstream consumers can match against the same constant.
 */
export const NEW_CHAT_PLACEHOLDER = "New chat";

/**
 * Pick the best label for a session row from server-provided fields,
 * falling back through summaries. Always returns a non-empty string —
 * sessions without a summary yet render with `NEW_CHAT_PLACEHOLDER`,
 * which `useSessionSummaries` upgrades to the Haiku-generated summary
 * as soon as the round-trip completes.
 *
 * `NEW_CHAT_PLACEHOLDER` rows are always navigable: aura-os-server's
 * `filter_nonempty_sessions` drops zero-event sessions out of the
 * list endpoints, so a "New chat" row here means "Haiku is mid-summary
 * for a real, persisted first turn", never "orphan empty session that
 * does nothing on click". An earlier iteration hid summary-less rows
 * entirely; that papered over the orphan-session bug at the cost of
 * making brand-new sessions vanish for the 1-3s Haiku round-trip.
 */
export function deriveSessionLabel(
  session: AnnotatedSession,
  fetchedSummary: string | undefined,
): string {
  const summary = session.summary_of_previous_context || fetchedSummary || "";
  if (summary.trim().length > 0) {
    return truncate(summary, 80);
  }
  return NEW_CHAT_PLACEHOLDER;
}

export type SessionRow = {
  session: AnnotatedSession;
  label: string;
};

export type DateBucket = {
  label: string;
  rows: SessionRow[];
};

export function bucketizeByDate(rows: SessionRow[]): DateBucket[] {
  const now = new Date();
  const order: string[] = [];
  const map = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const bucket = getDateBucket(row.session.started_at, now);
    if (!map.has(bucket)) {
      map.set(bucket, []);
      order.push(bucket);
    }
    map.get(bucket)!.push(row);
  }
  return order.map((label) => ({ label, rows: map.get(label)! }));
}
