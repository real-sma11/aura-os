import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { ContextBreakdown } from "../../../../stores/context-usage-store";
import styles from "./ChatInputBar.module.css";

export interface ContextUsageIndicatorProps {
  utilization: number;
  estimatedTokens?: number;
  /**
   * Per-bucket token estimates for the current session context.
   * When present, the popover renders the Cursor-style stacked-bar
   * breakdown (System prompt / Tools / Skills / MCP / Subagents /
   * Conversation). When absent (older harness builds, dev-loop
   * fallback, or fresh hydrate before the first turn), the popover
   * falls back to the legacy two-row Used/Total view so nothing
   * regresses.
   */
  breakdown?: ContextBreakdown;
  onNewSession?: () => void;
}

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

/**
 * Geometry for the inline progress ring drawn next to the percentage
 * label. The viewBox is intentionally larger than the rendered size so
 * the stroke renders crisply at 12px on hi-dpi displays. Track and
 * progress arcs share the same circle path; the progress arc uses
 * `stroke-dasharray` / `stroke-dashoffset` to expose the utilization,
 * and a `-90deg` rotation on the SVG itself moves the arc's start
 * point from 3 o'clock to 12 o'clock.
 */
const RING_VIEWBOX = 16;
const RING_RADIUS = 6;
const RING_STROKE = 2.25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatTokens(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return TOKEN_FORMATTER.format(Math.round(value));
}

/**
 * Compact "12.3K" style for the popover's token-count summary line so
 * it matches the visual density of the screenshot. Uses fixed-precision
 * 1-decimal `K` past 10K and integer `K` past 100K so two adjacent
 * popovers (Used vs Total) line up nicely.
 */
function formatTokensShort(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = Math.round(value);
  if (v < 1_000) return `${v}`;
  if (v < 10_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v < 1_000_000) return `${Math.round(v / 1_000)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

interface BucketRow {
  /** Stable id used for color-coding and `data-context-bucket`. */
  id: "system_prompt" | "tools" | "skills" | "mcp" | "subagents" | "conversation";
  label: string;
  tokens: number;
}

/**
 * Order matches the screenshot: System prompt, Tools, Skills, MCP,
 * Subagents, Conversation. `Conversation` lives at the bottom because
 * it's the dominant bucket on long sessions.
 */
function buildBucketRows(b: ContextBreakdown): BucketRow[] {
  return [
    { id: "system_prompt", label: "System prompt", tokens: b.systemPromptTokens },
    { id: "tools", label: "Tools", tokens: b.toolsTokens },
    { id: "skills", label: "Skills", tokens: b.skillsTokens },
    { id: "mcp", label: "MCP", tokens: b.mcpTokens },
    { id: "subagents", label: "Subagents", tokens: b.subagentsTokens },
    { id: "conversation", label: "Conversation", tokens: b.conversationTokens },
  ];
}

/**
 * Hover/pin popover for the bottom-bar context-window indicator. The
 * visible trigger keeps the legacy "NN%" pill and the reset button.
 *
 * Two popover variants live here:
 *  - When `breakdown` is populated, render the Cursor-style stacked-bar
 *    breakdown that shows the percentage, total tokens, and a
 *    color-coded segment per bucket alongside a labeled list.
 *  - Otherwise fall back to the legacy three-row "Context / Used /
 *    Total" card so older harness builds and the pre-first-turn state
 *    still communicate something useful.
 */
export function ContextUsageIndicator({
  utilization,
  estimatedTokens,
  breakdown,
  onNewSession,
}: ContextUsageIndicatorProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (!pinned) setOpen(true);
  }, [pinned]);
  const handleMouseLeave = useCallback(() => {
    if (!pinned) setOpen(false);
  }, [pinned]);
  const handleClick = useCallback(() => {
    if (pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  }, [pinned]);
  const handleClose = useCallback(() => {
    setPinned(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const percent = Math.round(utilization * 100);
  const safeUtilization = Math.max(0, Math.min(1, utilization));
  const ringDashOffset = RING_CIRCUMFERENCE * (1 - safeUtilization);
  const usedTokens = typeof estimatedTokens === "number" ? estimatedTokens : undefined;
  const totalTokens =
    usedTokens != null && utilization > 0 ? usedTokens / utilization : undefined;
  const hasTokens = usedTokens != null && totalTokens != null;

  const toneClass =
    utilization >= 0.9
      ? styles.contextDanger
      : utilization >= 0.7
        ? styles.contextWarning
        : "";

  const bucketRows: BucketRow[] = useMemo(
    () => (breakdown ? buildBucketRows(breakdown) : []),
    [breakdown],
  );
  // Hide MCP until the harness gains it (today the bucket is hard-zero
  // by design); never hide Conversation even when it's zero, so the
  // breakdown always shows the dominant bucket label.
  const visibleRows = useMemo(
    () =>
      bucketRows.filter(
        (r) => r.id === "conversation" || (r.id === "mcp" ? r.tokens > 0 : true),
      ),
    [bucketRows],
  );
  // The bar's total width represents the model's context window; each
  // segment's width is its bucket's share of the *window*, not just of
  // the used portion. That keeps the trailing empty space in the bar
  // visually meaningful as "headroom you still have".
  const segments = useMemo(() => {
    if (!breakdown || totalTokens == null || totalTokens <= 0) return [];
    return bucketRows
      .filter((r) => r.tokens > 0)
      .map((r) => ({
        ...r,
        widthPct: Math.min(100, (r.tokens / totalTokens) * 100),
      }));
  }, [bucketRows, breakdown, totalTokens]);

  return (
    <span
      ref={wrapperRef}
      className={styles.contextUsageWrap}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className={`${styles.contextIndicator}${toneClass ? ` ${toneClass}` : ""}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg
          className={styles.contextIndicatorRing}
          viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
          role="img"
          aria-label={`Context: ${percent}% used`}
          focusable="false"
        >
          <circle
            className={styles.contextIndicatorRingTrack}
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
          />
          <circle
            className={styles.contextIndicatorRingProgress}
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={ringDashOffset}
            strokeLinecap="round"
          />
        </svg>
        <span className={styles.contextIndicatorLabel}>{percent}% context</span>
      </span>
      {onNewSession ? (
        <button
          type="button"
          className={styles.newSessionButton}
          onClick={onNewSession}
          aria-label="Start new session"
        >
          <RotateCcw size={10} />
        </button>
      ) : null}

      {open && breakdown && hasTokens && (
        <div
          className={styles.contextBreakdownCard}
          role="dialog"
          aria-label="Context breakdown"
          data-agent-surface="chat-context-breakdown"
        >
          <div className={styles.contextBreakdownHeader}>
            <span className={styles.contextBreakdownTitle}>Context</span>
            <button
              type="button"
              className={styles.contextBreakdownClose}
              onClick={handleClose}
              aria-label="Close context breakdown"
            >
              <X size={12} />
            </button>
          </div>
          <div className={styles.contextBreakdownSummary}>
            <span
              className={`${styles.contextBreakdownPercent}${toneClass ? ` ${toneClass}` : ""}`}
            >
              {percent}% Full
            </span>
            <span className={styles.contextBreakdownTokens}>
              ~{formatTokensShort(usedTokens)} / {formatTokensShort(totalTokens)} Tokens
            </span>
          </div>
          <div
            className={styles.contextBreakdownBar}
            role="img"
            aria-label={`Context usage: ${percent} percent of the model window`}
          >
            {segments.map((s) => (
              <span
                key={s.id}
                className={styles.contextBreakdownSegment}
                data-context-bucket={s.id}
                style={{ flexBasis: `${s.widthPct}%` }}
                title={`${s.label}: ${formatTokens(s.tokens)} tokens`}
              />
            ))}
          </div>
          <div className={styles.contextBreakdownList}>
            {visibleRows.map((row) => (
              <div key={row.id} className={styles.contextBreakdownRow}>
                <span className={styles.contextBreakdownRowLeft}>
                  <span
                    className={styles.contextBreakdownSwatch}
                    data-context-bucket={row.id}
                    aria-hidden="true"
                  />
                  {row.label}
                </span>
                <span className={styles.contextBreakdownRowValue}>
                  {formatTokensShort(row.tokens)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (!breakdown || !hasTokens) && (
        <div className={styles.contextUsageCard} role="dialog">
          <div className={styles.contextUsageRow}>
            <span className={styles.contextUsageLabel}>Context</span>
            <span className={`${styles.contextUsageValue}${toneClass ? ` ${toneClass}` : ""}`}>
              {percent}% used
            </span>
          </div>
          {hasTokens && (
            <>
              <div className={styles.contextUsageRow}>
                <span className={styles.contextUsageLabel}>Used</span>
                <span className={styles.contextUsageValue}>
                  {formatTokens(usedTokens)} tokens
                </span>
              </div>
              <div className={styles.contextUsageRow}>
                <span className={styles.contextUsageLabel}>Total</span>
                <span className={styles.contextUsageValue}>
                  {formatTokens(totalTokens)} tokens
                </span>
              </div>
            </>
          )}
          {!hasTokens && (
            <div className={styles.contextUsageHint}>
              Token counts appear after the next assistant turn.
            </div>
          )}
        </div>
      )}
    </span>
  );
}
