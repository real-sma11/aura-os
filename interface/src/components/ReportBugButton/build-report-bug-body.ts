import { getBuildInfo } from "../../lib/build-info";
import { type StreamBreadcrumb } from "../../stores/stream-breadcrumbs-store";

/**
 * Format a single breadcrumb as a dense one-liner for the
 * Markdown code block in the bug report body. Keeps the layout
 * stable across entries that have different optional fields
 * populated (`code`, `support_id`, ...).
 */
function formatBreadcrumb(b: StreamBreadcrumb): string {
  const ts = new Date(b.ts).toISOString();
  const code = b.code ? ` code=${b.code}` : "";
  const support = b.support_id ? ` support_id=${b.support_id}` : "";
  return `${ts} [${b.classified}]${code}${support} ${b.message}`;
}

/**
 * Build the Markdown body the feedback composer can pre-fill with.
 * Exported so the auto-attach toggle path inside `NewFeedbackModal`
 * (the user-initiated open from the Feedback app) can produce the
 * same diagnostic bundle without duplicating the format.
 */
export function buildReportBugBody(opts: {
  streamKey?: string;
  supportId?: string;
  agentId?: string;
  sessionId?: string;
  breadcrumbs: StreamBreadcrumb[];
}): string {
  const { streamKey, supportId, agentId, sessionId, breadcrumbs } = opts;
  const buildVersion = getBuildInfo().version;
  const recentSupportIds = breadcrumbs
    .filter((b) => !!b.support_id)
    .map((b) => b.support_id!)
    .slice(-3);
  const supportIdsLine =
    recentSupportIds.length > 0
      ? recentSupportIds.join(", ")
      : (supportId ?? "n/a");
  const breadcrumbsBlock =
    breadcrumbs.length > 0
      ? breadcrumbs.map(formatBreadcrumb).join("\n")
      : "(no recent breadcrumbs captured)";
  return [
    `Build: ${buildVersion}`,
    `Stream key: ${streamKey ?? "n/a"}`,
    `Agent: ${agentId ?? "n/a"}`,
    `Session: ${sessionId ?? "n/a"}`,
    `Support IDs (last 3): ${supportIdsLine}`,
    "",
    "Recent breadcrumbs (last 20 for this stream):",
    "```",
    breadcrumbsBlock,
    "```",
  ].join("\n");
}
