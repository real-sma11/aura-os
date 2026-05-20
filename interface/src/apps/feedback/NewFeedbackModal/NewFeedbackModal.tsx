import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import { Select } from "../../../components/Select";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { useModalInitialFocus } from "../../../hooks/use-modal-initial-focus";
import { getBuildInfo } from "../../../lib/build-info";
import { useFeedbackStore } from "../../../stores/feedback-store";
import {
  getRecent,
  useStreamBreadcrumbsStore,
} from "../../../stores/stream-breadcrumbs-store";
import { buildReportBugBody } from "../../../components/ReportBugButton/ReportBugButton";
import {
  DEFAULT_FEEDBACK_PRODUCT,
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_PRODUCT_OPTIONS,
  FEEDBACK_STATUS_OPTIONS,
  type FeedbackCategory,
  type FeedbackProduct,
  type FeedbackStatus,
} from "../types";
import styles from "./NewFeedbackModal.module.css";

function isFeedbackProduct(value: string): value is FeedbackProduct {
  return FEEDBACK_PRODUCT_OPTIONS.some((option) => option.value === value);
}

function isFeedbackCategory(value: string): value is FeedbackCategory {
  return FEEDBACK_CATEGORY_OPTIONS.some((option) => option.value === value);
}

function isFeedbackStatus(value: string): value is FeedbackStatus {
  return FEEDBACK_STATUS_OPTIONS.some((option) => option.value === value);
}

/**
 * Phase 5: optional pre-fill bundle. The `ReportBugButton` open path
 * passes a fully-formed bundle (title, body, category, product) so
 * the modal can land already filled in. The user-initiated open
 * from the Feedback app passes nothing — and the auto-attach
 * toggle below offers to append the diagnostic bundle on submit
 * when the breadcrumb ring is non-empty.
 */
export interface NewFeedbackModalPrefill {
  title?: string;
  body?: string;
  category?: FeedbackCategory;
  status?: FeedbackStatus;
  product?: FeedbackProduct;
}

export interface NewFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefill?: NewFeedbackModalPrefill;
}

const DEFAULT_CATEGORY: FeedbackCategory = "feature_request";
const DEFAULT_STATUS: FeedbackStatus = "not_started";

export function NewFeedbackModal({ isOpen, onClose, prefill }: NewFeedbackModalProps) {
  const { inputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();
  const { isMobileLayout } = useAuraCapabilities();
  const createFeedback = useFeedbackStore((s) => s.createFeedback);
  const isSubmitting = useFeedbackStore((s) => s.isSubmitting);
  const composerError = useFeedbackStore((s) => s.composerError);
  const resetComposerError = useFeedbackStore((s) => s.resetComposerError);
  // Phase 5: subscribe to the breadcrumb count so the auto-attach
  // toggle's default-on/off state stays in sync if a fresh
  // breadcrumb lands while the modal is open. Reading the array
  // length only (not the entries themselves) keeps re-renders
  // cheap; the actual entries are pulled via `getRecent` at
  // submit time.
  const breadcrumbCount = useStreamBreadcrumbsStore(
    (s) => s.breadcrumbs.length,
  );

  // Stamp the active build version onto every new submission so support can
  // correlate feedback with the exact build the user is running. Memoised so
  // the value is stable across re-renders (build info doesn't change at
  // runtime, but recomputing each render is wasteful and would defeat the
  // identity-stable callback pattern below).
  const appVersion = useMemo(() => getBuildInfo().version, []);

  const [title, setTitle] = useState(prefill?.title ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [category, setCategory] = useState<FeedbackCategory>(
    prefill?.category ?? DEFAULT_CATEGORY,
  );
  const [status, setStatus] = useState<FeedbackStatus>(
    prefill?.status ?? DEFAULT_STATUS,
  );
  // Composer always defaults to AURA regardless of the current Product filter.
  // Users pick a different product explicitly via the Product select.
  const [product, setProduct] = useState<FeedbackProduct>(
    prefill?.product ?? DEFAULT_FEEDBACK_PRODUCT,
  );
  // Phase 5 auto-attach toggle. Only meaningful on user-initiated
  // opens (no `prefill.body` means the body is empty and the
  // toggle is the user's path to attaching diagnostics). When a
  // `ReportBugButton` open already filled the body with a
  // bundle, the toggle hides itself to avoid the user
  // accidentally double-stamping the same diagnostics.
  const [attachDiagnostics, setAttachDiagnostics] = useState(
    !prefill?.body && breadcrumbCount > 0,
  );
  const showAttachDiagnostics = !prefill?.body;

  useEffect(() => {
    if (!isOpen) {
      setTitle("");
      setBody("");
      setCategory(DEFAULT_CATEGORY);
      setStatus(DEFAULT_STATUS);
      setProduct(DEFAULT_FEEDBACK_PRODUCT);
      setAttachDiagnostics(false);
      resetComposerError();
      return;
    }
    // On open, re-apply the prefill (covers reopening the same
    // modal instance with a different bundle, and ensures the
    // freshest breadcrumb tail is reflected in the toggle's
    // default state).
    setTitle(prefill?.title ?? "");
    setBody(prefill?.body ?? "");
    setCategory(prefill?.category ?? DEFAULT_CATEGORY);
    setStatus(prefill?.status ?? DEFAULT_STATUS);
    setProduct(prefill?.product ?? DEFAULT_FEEDBACK_PRODUCT);
    setAttachDiagnostics(!prefill?.body && breadcrumbCount > 0);
  }, [
    isOpen,
    prefill?.title,
    prefill?.body,
    prefill?.category,
    prefill?.status,
    prefill?.product,
    breadcrumbCount,
    resetComposerError,
  ]);

  const canSubmit = body.trim().length > 0 && !isSubmitting;

  const composeSubmissionBody = (): string => {
    if (!showAttachDiagnostics || !attachDiagnostics) return body;
    const breadcrumbs = getRecent(20);
    if (breadcrumbs.length === 0) return body;
    const bundle = buildReportBugBody({ breadcrumbs });
    return body.trim().length > 0
      ? `${body}\n\n---\n\n${bundle}`
      : bundle;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const created = await createFeedback({
      title,
      body: composeSubmissionBody(),
      category,
      status,
      product,
      appVersion,
    });
    if (created) {
      const { track } = await import("../../../lib/analytics");
      track("feedback_created", { category, product });
      onClose();
    }
  };

  // ZUI's Modal re-runs its focus effect whenever `onClose`'s identity
  // changes, so stabilize this callback — otherwise every keystroke
  // triggers a re-render and yanks the cursor back to the title input.
  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  const handleBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setBody(event.target.value);
    if (composerError) resetComposerError();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Feedback"
      size={isMobileLayout ? "full" : "md"}
      fullHeight={isMobileLayout}
      className={isMobileLayout ? styles.mobileModal : undefined}
      contentClassName={isMobileLayout ? styles.mobileContent : undefined}
      initialFocusRef={initialFocusRef}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Cancel feedback"
            data-agent-action="cancel-feedback"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="Post feedback"
            data-agent-action="submit-feedback"
          >
            {isSubmitting ? "Posting..." : "Post"}
          </Button>
        </>
      }
    >
      <div
        className={styles.formColumn}
        data-agent-surface="feedback-composer"
        aria-label="Feedback composer"
      >
        <Input
          ref={inputRef}
          value={title}
          placeholder="Title (optional)"
          aria-label="Feedback title"
          data-agent-field="feedback-title"
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className={styles.fieldGroup}>
          <Text size="sm" className={styles.fieldLabel}>Feedback</Text>
          <textarea
            className={styles.bodyInput}
            value={body}
            placeholder="What's on your mind?"
            aria-label="Feedback body"
            data-agent-field="feedback-body"
            rows={5}
            onChange={handleBodyChange}
          />
        </div>
        <div className={styles.selectsRow}>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Product</span>
            <Select
              value={product}
              onChange={(v) => {
                if (isFeedbackProduct(v)) setProduct(v);
              }}
              options={[...FEEDBACK_PRODUCT_OPTIONS]}
            />
          </div>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Category</span>
            <Select
              value={category}
              onChange={(v) => {
                if (isFeedbackCategory(v)) setCategory(v);
              }}
              options={[...FEEDBACK_CATEGORY_OPTIONS]}
            />
          </div>
          <div className={styles.selectLabel}>
            <span className={styles.selectLabelText}>Status</span>
            <Select
              value={status}
              onChange={(v) => {
                if (isFeedbackStatus(v)) setStatus(v);
              }}
              options={[...FEEDBACK_STATUS_OPTIONS]}
            />
          </div>
        </div>
        {showAttachDiagnostics && (
          <label
            className={styles.attachDiagnosticsRow}
            data-agent-field="feedback-attach-diagnostics"
          >
            <input
              type="checkbox"
              checked={attachDiagnostics}
              disabled={breadcrumbCount === 0}
              onChange={(event) => setAttachDiagnostics(event.target.checked)}
              aria-label="Attach recent agent diagnostics"
            />
            <span>
              Attach recent agent diagnostics
              {breadcrumbCount === 0 ? " (none captured)" : ""}
            </span>
          </label>
        )}
        <Text
          size="xs"
          className={styles.versionHint}
          data-agent-proof="feedback-composer-version-visible"
          data-app-version={appVersion}
        >
          Tagged with version {appVersion}
        </Text>
        {composerError ? (
          <Text size="sm" className={styles.errorText} role="alert">
            {composerError}
          </Text>
        ) : null}
      </div>
    </Modal>
  );
}
