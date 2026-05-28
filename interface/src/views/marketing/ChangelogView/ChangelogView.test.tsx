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

  it("renders Current Version as a stat block in the card header (top-right) with the version number, release age, Download and GitHub links", async () => {
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

    // Label and value render in the same stat block, which now lives
    // in the top-right of the card header — confirm both the class and
    // the parent `<header>` so future markup moves don't silently
    // reintroduce the in-grid placement.
    const label = await screen.findByText(/Current version/i);
    const stat = label.closest(".changelogStat");
    expect(stat).not.toBeNull();
    expect(stat).toHaveClass("changelogStatVersion");
    expect(stat!.closest("header")).not.toBeNull();
    expect(stat!.closest("header")).toHaveClass("changelogStatsCardHeader");

    const value = stat!.querySelector(".changelogStatValue");
    expect(value?.textContent).toBe("1.2.3");

    const time = stat!.querySelector("time");
    expect(time?.textContent).toMatch(/Released 2 hours ago/);
    expect(time).toHaveAttribute("datetime", generatedAt);

    // The Current Version stat block hosts two links: an in-app
    // /download link (router-handled) and an external GitHub link that
    // opens the aura-os repo in a new tab.
    const links = stat!.querySelectorAll<HTMLAnchorElement>("a");
    expect(links.length).toBe(2);

    const [downloadLink, githubLink] = Array.from(links);
    expect(downloadLink).toHaveAttribute("href", "/download");
    expect(downloadLink.textContent).toMatch(/Download/);
    expect(downloadLink.getAttribute("target")).not.toBe("_blank");

    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/cypher-asi/aura-os",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink.getAttribute("rel") ?? "").toMatch(/noopener/);
    expect(githubLink.getAttribute("rel") ?? "").toMatch(/noreferrer/);
    expect(githubLink.textContent).toMatch(/GitHub/);
  });
});
