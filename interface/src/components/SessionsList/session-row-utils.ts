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

export function truncate(text: string, max: number): string {
  const first = text.split("\n")[0].trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1)}…`;
}

/**
 * Pick the best label for a session row from server-provided fields,
 * falling back through summaries. Returns `null` when the session has
 * no usable title yet — the caller hides the row in that case rather
 * than rendering a "New chat" placeholder.
 */
export function deriveSessionLabel(
  session: AnnotatedSession,
  fetchedSummary: string | undefined,
): string | null {
  const summary = session.summary_of_previous_context || fetchedSummary || "";
  if (summary.trim().length > 0) {
    return truncate(summary, 80);
  }
  return null;
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
