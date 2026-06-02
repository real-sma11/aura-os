import { describe, expect, it } from "vitest";
import { getDateBucket } from "./agent-info-utils";

// Fixed reference point: Monday, June 1, 2026 (local time). All cases
// are expressed relative to this `now` so the assertions are stable.
const NOW = new Date(2026, 5, 1, 18, 0, 0);

function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe("getDateBucket", () => {
  it("labels the current and previous day", () => {
    expect(getDateBucket(daysAgo(0), NOW)).toBe("Today");
    expect(getDateBucket(daysAgo(1), NOW)).toBe("Yesterday");
  });

  it("labels 2-6 days ago by weekday name", () => {
    // 3 days before Mon Jun 1, 2026 is Fri May 29, 2026.
    expect(getDateBucket(daysAgo(3), NOW)).toBe("Friday");
    // 6 days before is Tue May 26, 2026.
    expect(getDateBucket(daysAgo(6), NOW)).toBe("Tuesday");
  });

  it("groups the prior week under 'Previous Week'", () => {
    expect(getDateBucket(daysAgo(7), NOW)).toBe("Previous Week");
    expect(getDateBucket(daysAgo(13), NOW)).toBe("Previous Week");
  });

  it("groups older sessions by month and year", () => {
    // ~40 days before Jun 1, 2026 lands in April 2026.
    expect(getDateBucket(daysAgo(40), NOW)).toBe("April 2026");
  });
});
