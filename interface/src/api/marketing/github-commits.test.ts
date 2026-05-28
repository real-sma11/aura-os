import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AURA_PUBLIC_REPOS,
  fetchAuraCommitStats,
  parseLastPageFromLink,
  pstMonthStartIso,
} from "./github-commits";

interface FakeResponseInit {
  readonly status?: number;
  readonly statusText?: string;
  readonly linkHeader?: string;
  readonly body?: unknown;
}

function fakeResponse({
  status = 200,
  statusText = "OK",
  linkHeader,
  body = [],
}: FakeResponseInit = {}): Response {
  const headers = new Headers();
  if (linkHeader) {
    headers.set("Link", linkHeader);
  }
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers,
  });
}

const originalFetch = globalThis.fetch;

describe("parseLastPageFromLink", () => {
  it("returns the page number embedded in rel=last", () => {
    const header =
      '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/commits?per_page=1&page=237>; rel="last"';
    expect(parseLastPageFromLink(header)).toBe(237);
  });

  it("returns null when no rel=last segment is present", () => {
    expect(parseLastPageFromLink(null)).toBeNull();
    expect(parseLastPageFromLink("")).toBeNull();
    expect(
      parseLastPageFromLink(
        '<https://api.github.com/x?page=2>; rel="next"',
      ),
    ).toBeNull();
  });

  it("returns null when the rel=last URL is malformed", () => {
    expect(
      parseLastPageFromLink('<not a url>; rel="last"'),
    ).toBeNull();
  });
});

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

  it("aggregates commit counts across all repos using the Link header", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    // Each repo gets 2 calls (all-time then this-month). We return
    // distinct counts per repo so the aggregation can be verified.
    const repoAllTime: Record<string, number> = {
      "aura-os": 1234,
      "aura-harness": 567,
      "aura-router": 89,
      "aura-network": 432,
      "aura-storage": 210,
      "aura-swarm": 77,
      "aura-website": 321,
    };
    const repoThisMonth: Record<string, number> = {
      "aura-os": 42,
      "aura-harness": 13,
      "aura-router": 4,
      "aura-network": 7,
      "aura-storage": 9,
      "aura-swarm": 2,
      "aura-website": 11,
    };

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const match = url.match(/repos\/cypher-asi\/([^/]+)\/commits\?(.+)$/);
      if (!match) {
        throw new Error(`Unexpected URL: ${url}`);
      }
      const repo = match[1];
      const params = new URLSearchParams(match[2]);
      const isThisMonth = params.has("since");
      const count = isThisMonth ? repoThisMonth[repo] : repoAllTime[repo];
      return fakeResponse({
        linkHeader:
          `<https://api.github.com/repositories/0/commits?per_page=1&page=2>; rel="next", ` +
          `<https://api.github.com/repositories/0/commits?per_page=1&page=${count}>; rel="last"`,
      });
    });

    const stats = await fetchAuraCommitStats(new Date("2026-05-28T16:22:00Z"));

    expect(stats.partial).toBe(false);
    expect(stats.commitsAllTime).toBe(
      Object.values(repoAllTime).reduce((sum, v) => sum + v, 0),
    );
    expect(stats.commitsThisMonth).toBe(
      Object.values(repoThisMonth).reduce((sum, v) => sum + v, 0),
    );
    expect(stats.perRepo["aura-harness"]).toEqual({
      allTime: 567,
      thisMonth: 13,
    });
    expect(fetchMock).toHaveBeenCalledTimes(AURA_PUBLIC_REPOS.length * 2);
  });

  it("falls back to the response body length when no Link header is present", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const isThisMonth = params.has("since");
      // No Link header at all. All-time returns 1 commit, this-month returns 0.
      return fakeResponse({ body: isThisMonth ? [] : [{ sha: "abc" }] });
    });

    const stats = await fetchAuraCommitStats(new Date("2026-05-28T16:22:00Z"));

    expect(stats.partial).toBe(false);
    expect(stats.commitsAllTime).toBe(AURA_PUBLIC_REPOS.length);
    expect(stats.commitsThisMonth).toBe(0);
  });

  it("marks partial when a per-repo fetch fails and excludes its count", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("aura-swarm")) {
        return fakeResponse({ status: 503, statusText: "Service Unavailable" });
      }
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const isThisMonth = params.has("since");
      const count = isThisMonth ? 5 : 100;
      return fakeResponse({
        linkHeader: `<https://api.github.com/repos/x/y/commits?per_page=1&page=${count}>; rel="last"`,
      });
    });

    const stats = await fetchAuraCommitStats(new Date("2026-05-28T16:22:00Z"));

    expect(stats.partial).toBe(true);
    expect(stats.perRepo["aura-swarm"]).toEqual({ allTime: 0, thisMonth: 0 });
    // 6 successful repos * 100 all-time, 6 * 5 this-month.
    expect(stats.commitsAllTime).toBe(6 * 100);
    expect(stats.commitsThisMonth).toBe(6 * 5);
  });

  it("issues the request with the PST month-start as the since param", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(fakeResponse({ body: [] }));

    await fetchAuraCommitStats(new Date("2026-05-28T16:22:00Z"));

    const calls = fetchMock.mock.calls.map(([input]) =>
      typeof input === "string" ? input : (input as URL).toString(),
    );
    const sinceCalls = calls.filter((url) => url.includes("since="));
    expect(sinceCalls.length).toBe(AURA_PUBLIC_REPOS.length);
    const expectedSince = encodeURIComponent("2026-05-01T07:00:00.000Z");
    for (const url of sinceCalls) {
      expect(url).toContain(`since=${expectedSince}`);
    }
  });
});
