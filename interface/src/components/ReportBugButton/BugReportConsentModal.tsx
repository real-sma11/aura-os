import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { Button, Modal, Text } from "@cypher-asi/zui";
import { Select } from "../Select";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { bugReportsApi } from "../../api/bug-reports";
import {
  collectBugDiagnostics,
  type BugDiagnosticsInput,
} from "../../shared/observability/collect-bug-diagnostics";
import styles from "./BugReportConsentModal.module.css";

/**
 * Version stamped on every consent the user grants before a private
 * bug report is sent. Bump this whenever the consent copy below
 * changes so stored reports remain auditable against the exact
 * wording the user agreed to.
 */
export const BUG_REPORT_CONSENT_VERSION = "1";

const BUG_REPORT_CATEGORY = "bug";

const BUG_REPORT_CONSENT_COPY =
  "By sending this report you agree to share your prompt and conversation data " +
  "with the AURA dev team to help diagnose and fix this issue. This information " +
  "is used for diagnostic purposes only — it is not used for model training and " +
  "is not shared with anyone else.";

const SEVERITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const DEFAULT_SEVERITY = "medium";

export interface BugReportConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Context the calling surface already knows (stream key, support id,
   * agent id, session id). Threaded into `collectBugDiagnostics` at
   * submit time so the bundle is built against the freshest store
   * state rather than a stale snapshot taken on open.
   */
  diagnosticsInput: BugDiagnosticsInput;
}

function isSeverity(value: string): boolean {
  return SEVERITY_OPTIONS.some((option) => option.value === value);
}

/**
 * Consent-gated private bug-report composer. The user must type a
 * description and explicitly tick the consent checkbox before the
 * Send action enables — no prompt or diagnostic data leaves the
 * client until then. On submit it assembles the full diagnostic
 * bundle and POSTs it to `/api/bug-reports` with the granted consent,
 * its version, and a client-stamped timestamp.
 */
export function BugReportConsentModal({
  isOpen,
  onClose,
  diagnosticsInput,
}: BugReportConsentModalProps) {
  const { inputRef, initialFocusRef } = useModalInitialFocus<HTMLTextAreaElement>();
  const { isMobileLayout } = useAuraCapabilities();

  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState(DEFAULT_SEVERITY);
  const [consentGiven, setConsentGiven] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDescription("");
      setSeverity(DEFAULT_SEVERITY);
      setConsentGiven(false);
      setIsSubmitting(false);
      setSubmitted(false);
      setError(null);
    }
  }, [isOpen]);

  // Auto-dismiss shortly after a successful send so the user gets a clear
  // "it worked" beat without having to click again.
  useEffect(() => {
    if (!submitted) return;
    const id = setTimeout(() => onClose(), 1600);
    return () => clearTimeout(id);
  }, [submitted, onClose]);

  const canSubmit =
    consentGiven && description.trim().length > 0 && !isSubmitting;

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const diagnostics = collectBugDiagnostics(diagnosticsInput);
      await bugReportsApi.create({
        description: description.trim(),
        category: BUG_REPORT_CATEGORY,
        severity,
        diagnostics,
        consent: true,
        consentVersion: BUG_REPORT_CONSENT_VERSION,
        consentedAt: new Date().toISOString(),
      });
      void import("../../lib/analytics").then(({ track }) =>
        track("bug_report_created", { severity }),
      );
      setIsSubmitting(false);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not send the report. Please try again.",
      );
      setIsSubmitting(false);
    }
  };

  const handleDescriptionChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(event.target.value);
    if (error) setError(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Report a bug"
      size={isMobileLayout ? "full" : "md"}
      fullHeight={isMobileLayout}
      initialFocusRef={initialFocusRef}
      footer={
        submitted ? (
          <Button
            variant="primary"
            onClick={onClose}
            aria-label="Close bug report confirmation"
            data-agent-action="close-bug-report"
          >
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
              aria-label="Cancel bug report"
              data-agent-action="cancel-bug-report"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-label="Send bug report"
              data-agent-action="submit-bug-report"
            >
              {isSubmitting ? "Sending..." : "Send report"}
            </Button>
          </>
        )
      }
    >
      {submitted ? (
        <div
          className={styles.successBox}
          data-agent-proof="bug-report-sent"
          role="status"
        >
          <span className={styles.successTitle}>Report sent</span>
          <Text size="sm">
            Thanks — your report was added to the Feedback section, where you
            can track its progress.
          </Text>
        </div>
      ) : (
      <div
        className={styles.formColumn}
        data-agent-surface="bug-report-composer"
        aria-label="Bug report composer"
      >
        <div className={styles.fieldGroup}>
          <Text size="sm" className={styles.fieldLabel}>
            What went wrong?
          </Text>
          <textarea
            ref={inputRef}
            className={styles.bodyInput}
            value={description}
            placeholder="Describe what you were doing and what went wrong."
            aria-label="Bug description"
            data-agent-field="bug-report-description"
            rows={5}
            onChange={handleDescriptionChange}
          />
        </div>
        <div className={styles.severityField}>
          <Text size="sm" className={styles.fieldLabel}>
            Severity
          </Text>
          <Select
            value={severity}
            onChange={(v) => {
              if (isSeverity(v)) setSeverity(v);
            }}
            options={SEVERITY_OPTIONS}
          />
        </div>
        <div className={styles.summaryBox} data-agent-proof="bug-report-data-summary">
          <span className={styles.summaryTitle}>What gets sent</span>
          <ul className={styles.summaryList}>
            <li>Your prompt and recent conversation on this agent</li>
            <li>The model, agent, and session this happened on</li>
            <li>Environment details (build, platform, browser, locale)</li>
            <li>Recent error breadcrumbs and support IDs</li>
          </ul>
        </div>
        <label className={styles.consentRow} data-agent-field="bug-report-consent">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(event) => setConsentGiven(event.target.checked)}
            aria-label="Consent to share prompt and conversation data"
          />
          <span className={styles.consentCopy}>{BUG_REPORT_CONSENT_COPY}</span>
        </label>
        {error ? (
          <Text size="sm" className={styles.errorText} role="alert">
            {error}
          </Text>
        ) : null}
      </div>
      )}
    </Modal>
  );
}
