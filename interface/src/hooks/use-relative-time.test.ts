import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, useRelativeTime } from "./use-relative-time";

describe("formatRelativeTime", () => {
  const NOW = new Date("2026-05-28T17:00:00.000Z");

  it("returns 'just now' for sub-5-second deltas", () => {
    expect(
      formatRelativeTime("2026-05-28T16:59:58.000Z", NOW),
    ).toBe("just now");
    expect(formatRelativeTime(NOW.toISOString(), NOW)).toBe("just now");
  });

  it("formats seconds", () => {
    expect(formatRelativeTime("2026-05-28T16:59:13.000Z", NOW)).toBe(
      "47 seconds ago",
    );
  });

  it("formats minutes", () => {
    expect(formatRelativeTime("2026-05-28T16:57:00.000Z", NOW)).toBe(
      "3 minutes ago",
    );
    expect(formatRelativeTime("2026-05-28T16:59:00.000Z", NOW)).toBe(
      "1 minute ago",
    );
  });

  it("formats hours", () => {
    expect(formatRelativeTime("2026-05-28T15:00:00.000Z", NOW)).toBe(
      "2 hours ago",
    );
  });

  it("formats days, weeks, months, years", () => {
    expect(formatRelativeTime("2026-05-25T17:00:00.000Z", NOW)).toBe(
      "3 days ago",
    );
    expect(formatRelativeTime("2026-05-14T17:00:00.000Z", NOW)).toBe(
      "2 weeks ago",
    );
    expect(formatRelativeTime("2026-03-28T17:00:00.000Z", NOW)).toBe(
      "2 months ago",
    );
    expect(formatRelativeTime("2023-05-28T17:00:00.000Z", NOW)).toBe(
      "3 years ago",
    );
  });

  it("handles future timestamps with an 'in N' prefix", () => {
    expect(formatRelativeTime("2026-05-28T17:02:00.000Z", NOW)).toBe(
      "in 2 minutes",
    );
  });

  it("returns empty string for unparseable input", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("useRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T17:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the empty string when iso is undefined", () => {
    const { result } = renderHook(() => useRelativeTime(undefined));
    expect(result.current).toBe("");
  });

  it("refreshes the rendered string as wall-clock time advances", () => {
    // 3s before "now" — under the 5s "just now" threshold.
    const start = "2026-05-28T16:59:57.000Z";
    const { result } = renderHook(() => useRelativeTime(start));

    expect(result.current).toBe("just now");

    act(() => {
      // Advance 8 wall-clock seconds. The hook's sub-minute cadence is
      // 1s, so multiple timer ticks should fire and the rendered string
      // should now reflect "11 seconds ago".
      vi.advanceTimersByTime(8 * 1000);
    });
    expect(result.current).toBe("11 seconds ago");

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current).toBe("2 minutes ago");
  });
});
