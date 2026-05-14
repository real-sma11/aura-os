import { useCallback, useMemo, useState } from "react";
import { Button } from "@cypher-asi/zui";
import { NewFeedbackModal } from "../../apps/feedback/NewFeedbackModal";
import { getBuildInfo } from "../../lib/build-info";
import {
  getRecentForStream,
  type StreamBreadcrumb,
} from "../../stores/stream-breadcrumbs-store";
import {
  DEFAULT_FEEDBACK_PRODUCT,
  type FeedbackCategory,
} from "../../apps/feedback/types";

const REPORT_BUG_CATEGORY: FeedbackCategory = "bug";

export interface ReportBugButtonProps {
  /**
   * Stream the bug report is scoped to. Used to filter the
   * breadcrumb ring down to "what just happened on this stream"
   * so the pre-filled body stays focused on the failure the user
   * is reporting (rather than every other agent they touched
   * earlier in the session).
   */
  streamKey?: string;
  /**
   * Server-stamped support id parsed from the most recent
   * `ErrorMsg.message` for this stream. Pulled into both the
   * report title and the `Support IDs (last 3)` body line so
   * support can join the ticket back to the matching `tracing`
   * span without having to scrub the breadcrumb log themselves.
   */
  supportId?: string;
  /**
   * Optional agent id to surface in the report body. When the
   * caller doesn't have one (e.g. the chat is not pinned to an
   * agent yet) we fall back to "n/a" so the body always has
   * every line filled in.
   */
  agentId?: string;
  /**
   * Optional session id, same rationale as `agentId`.
   */
  sessionId?: string;
  /**
   * Compact rendering for inline placements (the chat error
   * bubble, the `StuckStreamPill`). Standard rendering uses the
   * default-sized button for surfaces that have more room
   * (e.g. a future "Recent issues" dialog).
   */
  compact?: boolean;
  /**
   * Optional suffix appended to the report title so callers can
   * disambiguate the surface that opened the report (e.g. the
   * stuck-stream pill vs. the error bubble) without changing
   * the modal's pre-fill shape.
   */
  titleSuffix?: string;
}

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
 * Build the Markdown body the report modal is pre-filled with.
 * Exported so the auto-attach toggle path inside `NewFeedbackModal`
 * (the user-initiated open from the Feedback app) can produce the
 * same bundle without duplicating the format.
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

/**
 * One-click "Report Bug" affordance. Opens a state-local instance
 * of `NewFeedbackModal` pre-filled with a redacted diagnostic
 * bundle (build version, stream + agent + session ids, the most
 * recent support ids, and the last 20 breadcrumbs for this
 * stream). The modal's local-state initializer picks up the
 * `prefill` prop on first open and resets back to defaults on
 * close, so a subsequent click rebuilds the bundle against fresh
 * breadcrumb data instead of reusing a stale snapshot.
 *
 * Lives in `components/` (not `apps/feedback/`) because it ships
 * inline in the chat error bubble and the stuck-stream pill —
 * surfaces that should not depend on the Feedback app being
 * mounted.
 */
export function ReportBugButton({
  streamKey,
  supportId,
  agentId,
  sessionId,
  compact = false,
  titleSuffix,
}: ReportBugButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const prefill = useMemo(() => {
    if (!isOpen) {
      // Only build the bundle while the modal is open. Otherwise
      // every breadcrumb write would re-run the memo (because the
      // store reference flips) and force every chat error bubble
      // to re-render. The modal's `isOpen` flip is the trigger.
      return null;
    }
    const breadcrumbs = streamKey ? getRecentForStream(streamKey, 20) : [];
    const titleBase = `Agent issue (support_id=${supportId ?? "n/a"})`;
    const title = titleSuffix ? `${titleBase} — ${titleSuffix}` : titleBase;
    const body = buildReportBugBody({
      streamKey,
      supportId,
      agentId,
      sessionId,
      breadcrumbs,
    });
    return {
      title,
      body,
      category: REPORT_BUG_CATEGORY,
      product: DEFAULT_FEEDBACK_PRODUCT,
    };
  }, [isOpen, streamKey, supportId, agentId, sessionId, titleSuffix]);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <Button
        variant="ghost"
        size={compact ? "sm" : "md"}
        onClick={handleOpen}
        aria-label="Report bug"
        data-agent-action="report-bug"
      >
        Report bug
      </Button>
      <NewFeedbackModal
        isOpen={isOpen}
        onClose={handleClose}
        prefill={prefill ?? undefined}
      />
    </>
  );
}
