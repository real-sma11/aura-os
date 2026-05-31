import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LiveCommitStats, fetchAuraCommitStats } from "./github-commits";

const originalFetch = globalThis.fetch;

describe("fetchAuraCommitStats", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reads the published snapshot from the static gh-pages URL", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: LiveCommitStats = {
      commitsThisMonth: 88,
      commitsAllTime: 2940,
      perRepo: {
        "aura-os": { thisMonth: 42, allTime: 1234 },
      },
      monthKey: "2026-05",
      fetchedAt: "2026-05-28T16:22:00.000Z",
      partial: false,
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const stats = await fetchAuraCommitStats();

    expect(stats).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl] = fetchMock.mock.calls[0];
    const url = typeof calledUrl === "string" ? calledUrl : calledUrl.toString();
    expect(url).toContain("commit-stats.json");
  });

  it("drops malformed per-repo entries but keeps valid totals", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          commitsThisMonth: 10,
          commitsAllTime: 100,
          monthKey: "2026-05",
          fetchedAt: "2026-05-28T16:22:00.000Z",
          partial: true,
          perRepo: {
            "aura-os": { thisMonth: 5, allTime: 50 },
            "aura-broken": { thisMonth: "nope" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const stats = await fetchAuraCommitStats();

    expect(stats.commitsAllTime).toBe(100);
    expect(stats.perRepo["aura-os"]).toEqual({ thisMonth: 5, allTime: 50 });
    expect(stats.perRepo["aura-broken"]).toBeUndefined();
  });

  it("rejects on a non-2xx response", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(fetchAuraCommitStats()).rejects.toBeTruthy();
  });

  it("rejects when the body is missing required totals", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchAuraCommitStats()).rejects.toBeTruthy();
  });
});
