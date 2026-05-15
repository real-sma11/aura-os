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

/**
 * Reactive ETA snapshot for the active generation on `key`. Returns
 * `null` when no generation is in flight on the entry — the
 * cooking-indicator can then render its plain shimmer without a
 * countdown.
 *
 * The initial estimate comes from {@link getImageModelEstimateMs}
 * (image-mode only; 3D and video fall back to the default until we
 * gather production timing data). Once the first `generation_progress`
 * frame lands with `percent >= ADAPTIVE_PERCENT_MIN`, the estimate
 * switches to the adaptive formula and refines on every subsequent
 * percent update.
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

  if (!active || startedAt == null || kind == null) return null;

  const elapsed = Math.max(0, now - startedAt);
  const baseEstimate = getImageModelEstimateMs(model);
  const hasAdaptive =
    typeof percent === "number" &&
    Number.isFinite(percent) &&
    percent >= ADAPTIVE_PERCENT_MIN &&
    percent < 100;

  // Adaptive estimate: total = elapsed * 100 / percent. Capped well
  // below `Number.MAX_SAFE_INTEGER` (effectively no-op for any
  // realistic percent) so a rounding edge can never project an
  // Infinity remaining.
  const total = hasAdaptive
    ? Math.min((elapsed * 100) / (percent as number), 24 * 60 * 60 * 1000)
    : baseEstimate;
  const remainingMs = total - elapsed;
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
