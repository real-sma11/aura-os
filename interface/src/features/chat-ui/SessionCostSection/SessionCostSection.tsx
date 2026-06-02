import { type ReactElement } from "react";
import { CostPerTokenOverlay } from "./CostPerTokenOverlay";
import styles from "./SessionCostSection.module.css";

/**
 * Fully-resolved values for the "Session Cost" section. The cost math is
 * done by the caller via `model-pricing.ts`; this component is purely
 * presentational so it stays trivial to test and render.
 */
export interface SessionCostView {
  modelLabel: string;
  inputTokens: number;
  outputTokens: number;
  /** Cache-read tokens consumed this session. */
  cacheReadTokens: number;
  /** Cache-write (creation) tokens consumed this session. */
  cacheCreationTokens: number;
  /**
   * All billed tokens consumed this session (input + output + cache).
   * Matches the basis of {@link totalCostUsd} / {@link avgCostPerMillionUsd}
   * so the displayed total reconciles with the cost.
   */
  totalTokens: number;
  /** Weighted-average billed cost across token types, USD per 1M tokens. */
  avgCostPerMillionUsd: number;
  totalCostUsd: number;
  inputRatePerMillionUsd: number;
  outputRatePerMillionUsd: number;
  cachedRatePerMillionUsd: number;
  /** True when no pricing is known for the model. */
  unknown: boolean;
}

export interface SessionCostSectionProps {
  view: SessionCostView;
  /**
   * When `false`, the section's own "Session Cost" title is omitted. Used
   * when an enclosing collapsible header already provides the label so the
   * heading isn't duplicated.
   */
  showTitle?: boolean;
}

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return TOKEN_FORMATTER.format(Math.round(value));
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatRatePerMillion(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)} / 1M`;
}

/**
 * "Session Cost" block rendered beneath the Context Composition breakdown
 * in the Context popover. Shows the model, cumulative tokens, the
 * weighted-average billed cost per token (with a per-type rate overlay),
 * and the total billed cost in dollars.
 */
export function SessionCostSection({
  view,
  showTitle = true,
}: SessionCostSectionProps): ReactElement {
  return (
    <div className={styles.section} data-agent-surface="chat-session-cost">
      {showTitle && <span className={styles.title}>Session Cost</span>}

      <div className={styles.row}>
        <span className={styles.label}>Model</span>
        <span className={styles.value}>{view.modelLabel}</span>
      </div>

      <span className={styles.groupLabel}>Tokens Consumed</span>
      <div className={styles.subRow}>
        <span className={styles.subLabel}>Input</span>
        <span className={styles.value}>{formatTokens(view.inputTokens)}</span>
      </div>
      <div className={styles.subRow}>
        <span className={styles.subLabel}>Output</span>
        <span className={styles.value}>{formatTokens(view.outputTokens)}</span>
      </div>
      {(view.cacheReadTokens > 0 || view.cacheCreationTokens > 0) && (
        <div className={styles.subRow}>
          <span className={styles.subLabel}>Cache (read/write)</span>
          <span className={styles.value}>
            {formatTokens(view.cacheReadTokens)} / {formatTokens(view.cacheCreationTokens)}
          </span>
        </div>
      )}
      <div className={styles.subRow}>
        <span className={styles.subLabel}>Total</span>
        <span className={styles.value}>{formatTokens(view.totalTokens)}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Avg. Cost per Token</span>
        <span className={`${styles.value} ${styles.rateValue}`}>
          <CostPerTokenOverlay
            inputRatePerMillionUsd={view.inputRatePerMillionUsd}
            outputRatePerMillionUsd={view.outputRatePerMillionUsd}
            cachedRatePerMillionUsd={view.cachedRatePerMillionUsd}
            formatRate={formatRatePerMillion}
          />
          {view.unknown ? "—" : formatRatePerMillion(view.avgCostPerMillionUsd)}
        </span>
      </div>

      <div className={`${styles.row} ${styles.totalRow}`}>
        <span className={styles.label}>Total Token Cost</span>
        <span className={styles.totalValue}>
          {view.unknown ? "—" : formatUsd(view.totalCostUsd)}
        </span>
      </div>

      {view.unknown && (
        <span className={styles.unknownNote}>Pricing unavailable for this model.</span>
      )}
    </div>
  );
}
