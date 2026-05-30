import { useCallback, useMemo, useState } from "react";
import { Button } from "@cypher-asi/zui";
import { BugReportConsentModal } from "./BugReportConsentModal";
import type { BugDiagnosticsInput } from "../../shared/observability/collect-bug-diagnostics";

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
 * One-click "Report Bug" affordance. Opens a consent-gated
 * `BugReportConsentModal` that assembles the full private
 * diagnostic bundle (prompt, recent transcript, model, agent /
 * session / project / org ids, machine + environment, and the
 * recent breadcrumbs for this stream) and submits it to
 * `POST /api/bug-reports` only after the user explicitly consents
 * to sharing their prompt and conversation data.
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
}: ReportBugButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const diagnosticsInput = useMemo<BugDiagnosticsInput>(
    () => ({ streamKey, supportId, agentId, sessionId }),
    [streamKey, supportId, agentId, sessionId],
  );

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
      <BugReportConsentModal
        isOpen={isOpen}
        onClose={handleClose}
        diagnosticsInput={diagnosticsInput}
      />
    </>
  );
}
