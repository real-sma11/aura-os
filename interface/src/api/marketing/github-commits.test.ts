import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LiveCommitStats,
  fetchAuraCommitStats,
  pstMonthStartIso,
} from "./github-commits";

const originalFetch = globalThis.fetch;

describe("pstMonthStartIso", () => {
  it("returns the UTC instant matching midnight PST on the first of the month", () => {
    const fixed = new Date("2026-05-28T16:22:00Z");
    const iso = pstMonthStartIso(fixed);
    // May 2026: PDT (UTC-7) so May 1 00:00 PDT == May 1 07:00 UTC.
    expect(iso).toBe("2026-05-01T07:00:00.000Z");
  });

  it("handles the PST winter offset", () => {
    const fixed = new Date("2026-01-15T20:00:00Z");
    const iso = pstMonthStartIso(fixed);
    // January 2026: PST (UTC-8) so Jan 1 00:00 PST == Jan 1 08:00 UTC.
    expect(iso).toBe("2026-01-01T08:00:00.000Z");
  });
});

describe("fetchAuraCommitStats", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reads the aggregate from the same-origin proxy with the PST since param", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: LiveCommitStats = {
      commitsThisMonth: 88,
      commitsAllTime: 2940,
      perRepo: {
        "aura-os": { thisMonth: 42, allTime: 1234 },
      },
      fetchedAt: "2026-05-28T16:22:00.000Z",
      partial: false,
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const stats = await fetchAuraCommitStats(new Date("2026-05-28T16:22:00Z"));

    expect(stats).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = typeof calledUrl === "string" ? calledUrl : calledUrl.toString();
    expect(url).toContain("/api/public/commit-stats");
    expect(url).toContain(`since=${encodeURIComponent("2026-05-01T07:00:00.000Z")}`);
  });

  it("propagates a non-2xx response as a rejection", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "boom", code: "unknown" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      fetchAuraCommitStats(new Date("2026-05-28T16:22:00Z")),
    ).rejects.toBeTruthy();
  });
});
