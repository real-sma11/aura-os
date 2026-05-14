/**
 * Phase 5 vitest for the breadcrumb ring-buffer store. Pins the
 * three guarantees the `ReportBugButton` pre-fill (and any future
 * support surface) depend on:
 *
 * - The ring caps at exactly `STREAM_BREADCRUMB_RING_CAP` entries.
 * - When full, the oldest entry is dropped on the next append
 *   (NOT the most recent).
 * - The per-stream selector returns the recent tail filtered to a
 *   single stream key, regardless of how many other streams have
 *   landed between the matches.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  appendBreadcrumb,
  clear,
  getRecent,
  getRecentForStream,
  STREAM_BREADCRUMB_RING_CAP,
  type StreamBreadcrumb,
} from "./stream-breadcrumbs-store";

function makeEntry(i: number, overrides: Partial<StreamBreadcrumb> = {}): StreamBreadcrumb {
  return {
    ts: 1_700_000_000_000 + i,
    classified: "completed",
    message: `entry-${i}`,
    ...overrides,
  };
}

describe("stream-breadcrumbs-store", () => {
  beforeEach(() => {
    clear();
  });

  it("appends entries in order and reports the new length", () => {
    expect(appendBreadcrumb(makeEntry(0))).toBe(1);
    expect(appendBreadcrumb(makeEntry(1))).toBe(2);
    expect(appendBreadcrumb(makeEntry(2))).toBe(3);
    const all = getRecent();
    expect(all).toHaveLength(3);
    expect(all.map((b) => b.message)).toEqual(["entry-0", "entry-1", "entry-2"]);
  });

  it("caps at STREAM_BREADCRUMB_RING_CAP entries when filled exactly", () => {
    for (let i = 0; i < STREAM_BREADCRUMB_RING_CAP; i++) {
      appendBreadcrumb(makeEntry(i));
    }
    const all = getRecent();
    expect(all).toHaveLength(STREAM_BREADCRUMB_RING_CAP);
    expect(all[0].message).toBe("entry-0");
    expect(all[STREAM_BREADCRUMB_RING_CAP - 1].message).toBe(
      `entry-${STREAM_BREADCRUMB_RING_CAP - 1}`,
    );
  });

  it("drops the oldest entry when appending past the cap", () => {
    for (let i = 0; i < STREAM_BREADCRUMB_RING_CAP + 5; i++) {
      appendBreadcrumb(makeEntry(i));
    }
    const all = getRecent();
    expect(all).toHaveLength(STREAM_BREADCRUMB_RING_CAP);
    // The first 5 entries (entry-0 .. entry-4) should have been
    // dropped to make room for the most recent 5.
    expect(all[0].message).toBe("entry-5");
    expect(all[all.length - 1].message).toBe(
      `entry-${STREAM_BREADCRUMB_RING_CAP + 4}`,
    );
  });

  it("getRecent honours a smaller-than-ring limit by returning the tail", () => {
    for (let i = 0; i < 10; i++) appendBreadcrumb(makeEntry(i));
    const tail = getRecent(3);
    expect(tail.map((b) => b.message)).toEqual(["entry-7", "entry-8", "entry-9"]);
  });

  it("getRecentForStream filters by streamKey across the global ring", () => {
    appendBreadcrumb(makeEntry(0, { streamKey: "alpha" }));
    appendBreadcrumb(makeEntry(1, { streamKey: "beta" }));
    appendBreadcrumb(makeEntry(2, { streamKey: "alpha" }));
    appendBreadcrumb(makeEntry(3, { streamKey: "alpha" }));
    appendBreadcrumb(makeEntry(4, { streamKey: "beta" }));

    const alphaTail = getRecentForStream("alpha");
    expect(alphaTail.map((b) => b.message)).toEqual(["entry-0", "entry-2", "entry-3"]);

    const betaTail = getRecentForStream("beta");
    expect(betaTail.map((b) => b.message)).toEqual(["entry-1", "entry-4"]);
  });

  it("getRecentForStream caps to the requested limit", () => {
    for (let i = 0; i < 30; i++) {
      appendBreadcrumb(makeEntry(i, { streamKey: "alpha" }));
    }
    const tail = getRecentForStream("alpha", 5);
    expect(tail).toHaveLength(5);
    expect(tail.map((b) => b.message)).toEqual([
      "entry-25",
      "entry-26",
      "entry-27",
      "entry-28",
      "entry-29",
    ]);
  });

  it("getRecentForStream returns an empty array for an unknown key (and a missing key arg)", () => {
    appendBreadcrumb(makeEntry(0, { streamKey: "alpha" }));
    expect(getRecentForStream("zeta")).toEqual([]);
    expect(getRecentForStream("")).toEqual([]);
  });

  it("clear empties the ring", () => {
    for (let i = 0; i < 5; i++) appendBreadcrumb(makeEntry(i));
    expect(getRecent()).toHaveLength(5);
    clear();
    expect(getRecent()).toEqual([]);
  });
});
