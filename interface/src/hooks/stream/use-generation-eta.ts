import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getImageModelEstimateMs } from "../../constants/models";
import type { GenerationKind } from "../../shared/types/stream";
import { useStreamStore } from "./store";

export interface GenerationEta {
  /**
   * Estimated remaining time in ms. Clamped to zero when the timer
   * has overrun (use {@link overrun} to detect that state instead of
   * relying on a sentinel).
   */
  remainingMs: number;
  /**
   * `true` once the per-model estimate has elapsed but the stream has
   * not yet emitted `generation_completed`. Callers swap the
   * countdown digits for an "Almost done…" label in this case.
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
 * The estimate is the per-model baseline from
 * {@link getImageModelEstimateMs} (image-mode tuned; 3D and video
 * fall back to the default until we gather production timing data).
 * The countdown ticks down linearly from `startedAt + baseline` to
 * zero; once it reaches zero the consumer flips the label to
 * "Almost done…" via {@link GenerationEta.overrun}.
 *
 * The `generation_progress.percent` field on the wire is intentionally
 * NOT consumed here. Earlier iterations recomputed the projection as
 * `elapsed * 100 / percent` and ratcheted a latched completion
 * timestamp downward whenever the candidate pointed sooner than the
 * latch. In production the upstream router (notably `gpt-image-2`)
 * emits sparse `percent` frames derived from `partial_image_index`,
 * which don't track wall-clock progress linearly — a single noisy
 * `percent=50` at `t=5s` would snap the countdown from `1:50` straight
 * to `0:05` and then overrun into "Almost done…" while 30–60s of real
 * work remained. The percent values are still routed into the store
 * by the wire handlers (so the stuck-stream watchdog and progress
 * text stay fed) but the ETA hook ignores them.
 *
 * Re-renders every ~1s while a generation is active so the digits
 * count down smoothly without needing a wire event. The interval is
 * cleared the moment the generation clears (terminal event or stream
 * reset).
 */
export function useGenerationEta(key: string): GenerationEta | null {
  const { startedAt, model, kind } = useStreamStore(
    useShallow((state) => ({
      startedAt: state.entries[key]?.generationStartedAt ?? null,
      model: state.entries[key]?.generationModel ?? null,
      kind: state.entries[key]?.generationKind ?? null,
    })),
  );

  const active = startedAt != null && kind != null;

  // Ticker decoupled from Zustand. The store fields only change on
  // start / clear, so without a periodic clock the countdown digits
  // would freeze.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active || startedAt == null || kind == null) {
    return null;
  }

  const completionAtMs = startedAt + getImageModelEstimateMs(model);
  const remainingMs = completionAtMs - now;
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
