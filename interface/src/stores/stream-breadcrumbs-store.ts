/**
 * Phase 5 Zustand store backing {@link recordStreamCloseReason}.
 *
 * The breadcrumb log is intentionally a single global flat array
 * (not per-stream) because the support workflow it feeds — the
 * `ReportBugButton` pre-fill — wants the most recent N events
 * across ALL streams the user has touched in this session, then
 * filters down to a single `streamKey` only at render time. Keeping
 * the storage flat avoids needing a per-key TTL / eviction layer
 * and makes "show me the last 50 things that happened in this tab"
 * the natural primary access pattern.
 *
 * Capped at {@link STREAM_BREADCRUMB_RING_CAP} entries with an
 * oldest-drop ring policy so a chatty session can't blow up
 * memory. Writes are O(1) (an `Array.slice` over at most
 * `cap + 1` entries) so the breadcrumb store is cheap enough to
 * call from every text-delta classification path.
 */

import { create } from "zustand";
import type { StreamCloseClassification } from "../shared/observability/stream-breadcrumbs";

/**
 * Wire shape of a single persisted breadcrumb. Mirrors
 * {@link StreamCloseReason} but with a wall-clock timestamp and the
 * optional context the chat hooks can thread through (stream key,
 * agent id, session id, server-side `support_id`). All context
 * fields are optional so legacy call sites that don't have the
 * context still produce a useful entry.
 */
export interface StreamBreadcrumb {
  ts: number;
  streamKey?: string;
  classified: StreamCloseClassification;
  code?: string;
  support_id?: string;
  message: string;
  agentId?: string;
  sessionId?: string;
}

/**
 * Hard cap on the in-memory ring. Sized so the per-stream selector
 * (`getRecentForStream`) can still surface a useful tail (~last 20
 * for the active stream) even when the user has been bouncing
 * between several agents in the same session.
 */
export const STREAM_BREADCRUMB_RING_CAP = 50;

interface StreamBreadcrumbsState {
  breadcrumbs: StreamBreadcrumb[];
}

/**
 * Underlying store. Exported so test setup can `setState` directly
 * (matches the pattern used by `feedback-store.ts`,
 * `message-queue-store.ts`, etc.). Production code should prefer
 * the {@link appendBreadcrumb} / {@link getRecent} / {@link clear}
 * helpers below so the cap is enforced consistently.
 */
export const useStreamBreadcrumbsStore = create<StreamBreadcrumbsState>()(() => ({
  breadcrumbs: [],
}));

/**
 * Append a single breadcrumb to the ring, dropping the oldest entry
 * when the cap is exceeded. Returns the new length so callers (and
 * tests) can assert ring behaviour without subscribing to the store.
 */
export function appendBreadcrumb(entry: StreamBreadcrumb): number {
  let nextLength = 0;
  useStreamBreadcrumbsStore.setState((s) => {
    const merged = s.breadcrumbs.length >= STREAM_BREADCRUMB_RING_CAP
      ? [...s.breadcrumbs.slice(s.breadcrumbs.length - STREAM_BREADCRUMB_RING_CAP + 1), entry]
      : [...s.breadcrumbs, entry];
    nextLength = merged.length;
    return { breadcrumbs: merged };
  });
  return nextLength;
}

/**
 * Snapshot the most recent breadcrumbs across every stream. Returns
 * a defensive copy so callers can mutate the array (e.g. reverse,
 * slice) without risking the live store. Defaults to the full ring
 * (up to {@link STREAM_BREADCRUMB_RING_CAP}); pass an explicit
 * `limit` for callers that only want the tail.
 */
export function getRecent(limit = STREAM_BREADCRUMB_RING_CAP): StreamBreadcrumb[] {
  const all = useStreamBreadcrumbsStore.getState().breadcrumbs;
  if (limit >= all.length) return [...all];
  return all.slice(all.length - limit);
}

/**
 * Snapshot the most recent breadcrumbs for a specific stream key.
 * Filters across the global ring so a long-tailed session that
 * recently touched stream A but is now on stream B still returns
 * stream B's most recent activity (rather than padding with stale
 * stream A entries). `limit` defaults to 20 — the same window the
 * `ReportBugButton` pre-fill uses — but is overridable for the
 * Phase 5 tests.
 */
export function getRecentForStream(streamKey: string, limit = 20): StreamBreadcrumb[] {
  if (!streamKey) return [];
  const all = useStreamBreadcrumbsStore.getState().breadcrumbs;
  const filtered = all.filter((b) => b.streamKey === streamKey);
  if (limit >= filtered.length) return filtered;
  return filtered.slice(filtered.length - limit);
}

/**
 * Reset the ring. Exposed for test setup / `beforeEach` so vitest
 * runs don't carry breadcrumbs across cases. Production never calls
 * this — the ring drains naturally via the cap.
 */
export function clear(): void {
  useStreamBreadcrumbsStore.setState({ breadcrumbs: [] });
}
