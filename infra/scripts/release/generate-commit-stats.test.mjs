import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AURA_PUBLIC_REPOS,
  mergeSnapshot,
  parseLastPageFromLink,
  pstMonthAnchor,
} from "./generate-commit-stats.mjs";

test("parseLastPageFromLink reads the rel=last page", () => {
  const header = [
    '<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel="next"',
    '<https://api.github.com/repositories/1/commits?per_page=1&page=5055>; rel="last"',
  ].join(", ");
  assert.equal(parseLastPageFromLink(header), 5055);
});

test("parseLastPageFromLink returns null without a rel=last link", () => {
  assert.equal(parseLastPageFromLink(null), null);
  assert.equal(parseLastPageFromLink(""), null);
  assert.equal(
    parseLastPageFromLink('<https://api.github.com/x?page=2>; rel="next"'),
    null,
  );
  assert.equal(parseLastPageFromLink('<not a url>; rel="last"'), null);
});

test("pstMonthAnchor anchors to the first of the PST month", () => {
  const may = pstMonthAnchor(new Date("2026-05-28T16:22:00Z"));
  // May 2026 is PDT (UTC-7): May 1 00:00 PDT == May 1 07:00 UTC.
  assert.equal(may.sinceIso, "2026-05-01T07:00:00.000Z");
  assert.equal(may.monthKey, "2026-05");

  const jan = pstMonthAnchor(new Date("2026-01-15T20:00:00Z"));
  // January 2026 is PST (UTC-8): Jan 1 00:00 PST == Jan 1 08:00 UTC.
  assert.equal(jan.sinceIso, "2026-01-01T08:00:00.000Z");
  assert.equal(jan.monthKey, "2026-01");
});

test("mergeSnapshot sums successful fetches and clears partial", () => {
  const repos = ["aura-os", "aura-harness"];
  const { anySuccess, snapshot } = mergeSnapshot({
    repos,
    fetched: {
      "aura-os": { allTime: 5000, thisMonth: 1000 },
      "aura-harness": { allTime: 200, thisMonth: 50 },
    },
    prior: null,
    monthKey: "2026-05",
    fetchedAt: "2026-05-31T00:00:00.000Z",
  });

  assert.equal(anySuccess, true);
  assert.equal(snapshot.partial, false);
  assert.equal(snapshot.commitsAllTime, 5200);
  assert.equal(snapshot.commitsThisMonth, 1050);
  assert.deepEqual(snapshot.perRepo["aura-os"], { thisMonth: 1000, allTime: 5000 });
});

test("mergeSnapshot keeps a failed repo's prior all-time instead of zeroing", () => {
  const repos = ["aura-os", "aura-harness"];
  const prior = {
    monthKey: "2026-05",
    perRepo: {
      "aura-os": { thisMonth: 900, allTime: 4900 },
      "aura-harness": { thisMonth: 40, allTime: 180 },
    },
  };
  const { anySuccess, snapshot } = mergeSnapshot({
    repos,
    fetched: {
      "aura-os": { allTime: 5000, thisMonth: 1000 },
      "aura-harness": { allTime: null, thisMonth: null },
    },
    prior,
    monthKey: "2026-05",
    fetchedAt: "2026-05-31T00:00:00.000Z",
  });

  assert.equal(anySuccess, true);
  assert.equal(snapshot.partial, true);
  // aura-harness failed -> carries prior counts (same month).
  assert.deepEqual(snapshot.perRepo["aura-harness"], { thisMonth: 40, allTime: 180 });
  assert.equal(snapshot.commitsAllTime, 5180);
  assert.equal(snapshot.commitsThisMonth, 1040);
});

test("mergeSnapshot resets a failed repo's this-month across a month boundary", () => {
  const prior = {
    monthKey: "2026-04",
    perRepo: { "aura-os": { thisMonth: 800, allTime: 4800 } },
  };
  const { snapshot } = mergeSnapshot({
    repos: ["aura-os"],
    fetched: { "aura-os": { allTime: null, thisMonth: null } },
    prior,
    monthKey: "2026-05",
    fetchedAt: "2026-05-01T08:00:00.000Z",
  });

  // All-time still carries; this-month does NOT (prior was last month).
  assert.equal(snapshot.perRepo["aura-os"].allTime, 4800);
  assert.equal(snapshot.perRepo["aura-os"].thisMonth, 0);
});

test("mergeSnapshot reports anySuccess=false when every repo fails", () => {
  const { anySuccess } = mergeSnapshot({
    repos: AURA_PUBLIC_REPOS,
    fetched: Object.fromEntries(
      AURA_PUBLIC_REPOS.map((r) => [r, { allTime: null, thisMonth: null }]),
    ),
    prior: null,
    monthKey: "2026-05",
    fetchedAt: "2026-05-31T00:00:00.000Z",
  });
  assert.equal(anySuccess, false);
});
