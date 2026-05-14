import { useEffect, useState } from "react";
import { useStreamStore } from "./store";

/**
 * Threshold (ms) past which an `isStreaming` entry with no fresh
 * wire event is considered "stuck". Phase 1 send guards consult
 * this constant directly so the queue/stuck branching matches the
 * watchdog exactly. Mirrors the value the Phase 2 watchdog UI will
 * surface.
 */
export const STUCK_THRESHOLD_MS = 30_000;

/**
 * Threshold (ms) past which a stuck stream is considered fully
 * timed out — the Phase 2 watchdog promotes a synthetic
 * `assistant_stuck_local_timeout` event at this point. Re-exported
 * here so consumers and tests have a single source of truth.
 */
export const FULLY_TIMED_OUT_MS = 60_000;

export interface StreamHealth {
  isStreaming: boolean;
  /**
   * Wall-clock ms of the last SSE-driven setter for this key, or
   * `null` if no wire event has landed yet for the entry.
   */
  lastEventAt: number | null;
  /**
   * `Date.now() - lastEventAt`, ticked every ~1s while streaming so
   * consumers re-render even though `lastEventAt` only changes when
   * a wire event actually arrives. `null` when not streaming or
   * when no event has been observed yet.
   */
  lastEventAgeMs: number | null;
  /** `true` iff `isStreaming && lastEventAgeMs >= STUCK_THRESHOLD_MS`. */
  isStuck: boolean;
  /**
   * How long the stream has been considered stuck in ms. `null`
   * when not stuck. Computed against `lastEventAt` (not `stuckSince`)
   * so the value increments smoothly as the watchdog ticks rather
   * than jumping when `stuckSince` is first stamped.
   */
  stuckForMs: number | null;
}

/**
 * Reactive snapshot of stream health for `key`. Re-renders every
 * ~1s while `isStreaming` is true so the watchdog UI and stuck-
 * stream send guards can re-evaluate against wall clock without
 * waiting for a wire event to flip Zustand. Cleans up the interval
 * the moment streaming ends.
 */
export function useStreamHealth(key: string): StreamHealth {
  const isStreaming = useStreamStore(
    (s) => s.entries[key]?.isStreaming ?? false,
  );
  const lastEventAt = useStreamStore(
    (s) => s.entries[key]?.lastEventAt ?? null,
  );

  // Ticker decoupled from Zustand. `lastEventAt` only changes when a
  // wire event lands, so without a periodic clock we'd never re-
  // render to flip `isStuck` true on a genuinely-stalled stream.
  // `now` is held in component state (initialized lazily so the
  // call to `Date.now` happens at mount, not during a render pass —
  // satisfies the React purity rule) and bumped every ~1s by the
  // interval below while streaming is active.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Clamp to zero: if `lastEventAt` was just stamped after a long
  // idle window, `now` (last tick or mount time) can briefly trail
  // behind it before the next interval bump. A negative age would
  // confuse downstream consumers and we'd rather report "fresh"
  // until the next tick lines the values up.
  const lastEventAgeMs =
    isStreaming && lastEventAt != null
      ? Math.max(0, now - lastEventAt)
      : null;
  const isStuck =
    isStreaming &&
    lastEventAgeMs != null &&
    lastEventAgeMs >= STUCK_THRESHOLD_MS;
  const stuckForMs =
    isStuck && lastEventAgeMs != null
      ? lastEventAgeMs - STUCK_THRESHOLD_MS
      : null;

  return { isStreaming, lastEventAt, lastEventAgeMs, isStuck, stuckForMs };
}
