import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChangelogView } from "./ChangelogView";
import * as githubCommits from "../../../api/marketing/github-commits";
import * as changelogApi from "../../../api/marketing/changelog";
import type { ChangelogEntry } from "../../../api/marketing/changelog";

function renderChangelogView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ChangelogView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function getCommitStatValueElement(label: RegExp): HTMLElement {
  const labelEl = screen.getByText(label);
  const stat = labelEl.closest(".changelogStat");
  if (!stat) {
    throw new Error(`Could not find .changelogStat parent for ${label}`);
  }
  const value = stat.querySelector<HTMLElement>(".changelogStatValue");
  if (!value) {
    throw new Error(`Missing .changelogStatValue for ${label}`);
  }
  return value;
}

describe("ChangelogView", () => {
  beforeEach(() => {
    // Force prefers-reduced-motion so the count-up snaps to the resolved
    // value in a single tick. This keeps the assertion deterministic
    // without needing a fake-RAF clock here — `useCountUp.test.ts` has
    // dedicated animation-clock coverage already.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without throwing and shows the Changelog heading", () => {
    renderChangelogView();
    expect(
      screen.getByRole("heading", { level: 1, name: /Changelog/ }),
    ).toBeInTheDocument();
  });

  it("shows a loading sentinel for the live commit stats while the GitHub fetch is pending", () => {
    // Return a Promise that never resolves during this test so the
    // query stays in the pending state and the stats render their
    // initial count-up state (0 under reduced-motion).
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockReturnValue(
      new Promise(() => undefined),
    );

    renderChangelogView();

    const thisMonth = getCommitStatValueElement(/Commits this month/);
    expect(thisMonth).toHaveAttribute("aria-busy", "true");
    expect(thisMonth.textContent).toBe("0");

    const allTime = getCommitStatValueElement(/All-time commits/);
    expect(allTime).toHaveAttribute("aria-busy", "true");
    expect(allTime.textContent).toBe("0");
  });

  it("renders the live commit totals once fetchAuraCommitStats resolves", async () => {
    vi.spyOn(githubCommits, "fetchAuraCommitStats").mockResolvedValue({
      commitsThisMonth: 137,
      commitsAllTime: 9421,
      perRepo: Object.fromEntries(
        githubCommits.AURA_PUBLIC_REPOS.map((repo) => [
          repo,
          { thisMonth: 0, allTime: 0 },
        ]),
      ),
      fetchedAt: new Date().toISOString(),
      partial: false,
    });

    renderChangelogView();

    await waitFor(() => {
      expect(
        getCommitStatValueElement(/Commits this month/).textContent,
      ).toBe("137");
    });

    const thisMonth = getCommitStatValueElement(/Commits this month/);
    expect(thisMonth).toHaveAttribute("aria-busy", "false");
    expect(thisMonth).toHaveAttribute(
      "title",
      `Live total across ${githubCommits.AURA_PUBLIC_REPOS.length} AURA repositories`,
    );

    const allTime = getCommitStatValueElement(/All-time commits/);
    expect(allTime.textContent).toBe("9,421");
    expect(allTime).toHaveAttribute("aria-busy", "false");
  });

  it("renders the latest-release relative time and a /download link in the header", async () => {
    // Anchor the timestamp 2 hours before the actual test-runner clock
    // so the relative-time string is deterministic ("2 hours ago")
    // without us having to stand up a fake timer (which would interfere
    // with React Query's internal scheduling here).
    const generatedAt = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const fakeEntry: ChangelogEntry = {
      repo: "aura-os",
      date: "2026-05-28",
      channel: "nightly",
      version: "1.2.3",
      generatedAt,
      releaseUrl: "https://github.com/cypher-asi/aura-os/releases/tag/v1.2.3",
      rawCommitCount: 0,
      filteredCommitCount: 0,
      rendered: {
        title: "Test release",
        intro: "",
        highlights: [],
        entries: [],
      },
    };

    vi.spyOn(changelogApi, "fetchChangelogEntries").mockResolvedValue([
      fakeEntry,
    ]);

    renderChangelogView();

    const time = await screen.findByText(/Released 2 hours ago/);
    expect(time.tagName.toLowerCase()).toBe("time");
    expect(time).toHaveAttribute("datetime", generatedAt);

    const downloadLink = screen.getByRole("link", { name: /Download/ });
    expect(downloadLink).toHaveAttribute("href", "/download");
  });
});
