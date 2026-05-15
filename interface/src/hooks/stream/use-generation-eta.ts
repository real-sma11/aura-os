import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getImageModelEstimateMs } from "../../constants/models";
import type { GenerationKind } from "../../shared/types/stream";
import { useStreamStore } from "./store";

/**
 * Minimum percent value we trust enough to switch from the per-model
 * fallback estimate to the adaptive `elapsed * (100 - percent) /
 * percent` formula. Below this threshold the formula is dominated by
 * noise (a 1% reading after 2s would project a 200s total) so we keep
 * the fallback in place until the upstream router reports something
 * meaningful.
 */
const ADAPTIVE_PERCENT_MIN = 5;

export interface GenerationEta {
  /**
   * Estimated remaining time in ms. Clamped to zero when the timer
   * has overrun (use {@link overrun} to detect that state instead of
   * relying on a sentinel).
   */
  remainingMs: number;
  /**
   * `true` once the estimate has elapsed but the stream has not yet
   * emitted `generation_completed`. Callers swap the countdown digits
   * for an "Almost done…" label in this case.
   */
  overrun: boolean;
  /** The generation kind from the store; surfaced for label routing. */
  kind: GenerationKind;
}

interface LatchedCompletion {
  /**
   * Wall-clock ms at which we currently project the generation will
   * finish. Monotonically non-increasing across one run: a new
   * estimate that points further out is ignored (it would jump the
   * countdown digits upward), while a sooner estimate ratchets the
   * latch down so the user sees "we're going to finish earlier than
   * I told you".
   */
  completionAtMs: number;
  /**
   * `startedAt` value the latch was bound to. A change here means a
   * new generation run and the latch resets from scratch — without
   * this guard, a quick second send would inherit the previous run's
   * floor and project an immediately-overrun countdown.
   */
  startedAt: number;
}

/**
 * Reactive ETA snapshot for the active generation on `key`. Returns
 * `null` when no generation is in flight on the entry — the
 * cooking-indicator can then render its plain shimmer without a
 * countdown.
 *
 * The initial estimate comes from {@link getImageModelEstimateMs}
 * (image-mode only; 3D and video fall back to the default until we
 * gather production timing data). Once the first `generation_progress`
 * frame lands with `percent >= ADAPTIVE_PERCENT_MIN`, the adaptive
 * formula can ratchet the projection downward.
 *
 * The projected completion timestamp is latched in state and
 * monotonically non-increasing for the lifetime of a single run, so
 * the digits only ever count down: noisy early percent values that
 * would project a later completion are ignored, while sooner
 * projections shorten the latch. The displayed value uses
 * `min(latched, candidate)` so the very first render is already
 * stable before the latch-syncing effect runs. This matches the
 * user's expectation that an ETA goes down with the clock, not
 * bounces.
 *
 * Re-renders every ~1s while a generation is active so the digits
 * count down smoothly without needing a wire event. The interval is
 * cleared the moment the generation clears (terminal event or stream
 * reset).
 */
export function useGenerationEta(key: string): GenerationEta | null {
  const { startedAt, model, kind, percent } = useStreamStore(
    useShallow((state) => ({
      startedAt: state.entries[key]?.generationStartedAt ?? null,
      model: state.entries[key]?.generationModel ?? null,
      kind: state.entries[key]?.generationKind ?? null,
      percent: state.entries[key]?.generationPercent ?? null,
    })),
  );

  const active = startedAt != null && kind != null;

  // Ticker decoupled from Zustand. The store fields only change on
  // start / percent update / clear, so without a periodic clock the
  // countdown digits would freeze between wire events.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const [latched, setLatched] = useState<LatchedCompletion | null>(null);

  // Compute the candidate every render so we always have an
  // up-to-date floor for the displayed value, even on the very first
  // render before the latch-sync effect runs. Inputs are stable
  // (`startedAt`, `model`, `percent` only change on wire events), so
  // this is cheap.
  const elapsed = active && startedAt != null ? Math.max(0, now - startedAt) : 0;
  const baseEstimate = getImageModelEstimateMs(model);
  const hasAdaptive =
    typeof percent === "number" &&
    Number.isFinite(percent) &&
    percent >= ADAPTIVE_PERCENT_MIN &&
    percent < 100;

  // Candidate total in ms. Cap the adaptive formula well below
  // `Number.MAX_SAFE_INTEGER` so a rounding edge can never project
  // an Infinity completion timestamp.
  const candidateTotal = hasAdaptive
    ? Math.min((elapsed * 100) / (percent as number), 24 * 60 * 60 * 1000)
    : baseEstimate;
  const candidateCompletionAtMs =
    startedAt != null ? startedAt + candidateTotal : 0;

  // Sync the latch outside of render. Three cases:
  //   1. Generation cleared -> drop the latch so the next run starts
  //      fresh and doesn't inherit a stale floor.
  //   2. New `startedAt` (a second send) -> seed from the current
  //      candidate.
  //   3. Same run, sooner candidate -> ratchet down. Later candidates
  //      are deliberately dropped so the digits never jump upward.
  useEffect(() => {
    if (!active || startedAt == null) {
      setLatched((prev) => (prev === null ? prev : null));
      return;
    }
    setLatched((prev) => {
      if (prev === null || prev.startedAt !== startedAt) {
        return { startedAt, completionAtMs: candidateCompletionAtMs };
      }
      if (candidateCompletionAtMs < prev.completionAtMs) {
        return { startedAt, completionAtMs: candidateCompletionAtMs };
      }
      return prev;
    });
  }, [active, startedAt, candidateCompletionAtMs]);

  if (!active || startedAt == null || kind == null) {
    return null;
  }

  // Effective completion is the lower of the latched floor (if it
  // belongs to this run) and the current candidate. The min keeps the
  // first render correct before the effect above has had a chance to
  // seed `latched`, and keeps subsequent renders monotonically
  // non-increasing because the latch can only ratchet down.
  const latchedForThisRun =
    latched !== null && latched.startedAt === startedAt
      ? latched.completionAtMs
      : Number.POSITIVE_INFINITY;
  const effectiveCompletionAtMs = Math.min(
    latchedForThisRun,
    candidateCompletionAtMs,
  );

  const remainingMs = effectiveCompletionAtMs - now;
  return {
    remainingMs: Math.max(0, remainingMs),
    overrun: remainingMs <= 0,
    kind,
  };
}

/**
 * Format `remainingMs` as `m:ss` (e.g. `0:42`, `1:05`). Rounds up so
 * the displayed digit only ticks when the wall-clock has fully
 * crossed a second boundary — `0:01` should be visible for a full
 * second before flipping to `0:00`, not flash by during the trailing
 * fraction.
 */
export function formatCountdown(remainingMs: number): string {
  const safeMs = Math.max(0, remainingMs);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
