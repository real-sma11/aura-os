import { describe, expect, it } from "vitest";
import {
  channelOf,
  compareVersions,
  countReleasesBehind,
  fallbackReleasesBehind,
  parseGithubRepo,
  parseVersion,
  type ReleaseTag,
} from "./version-distance";

describe("parseVersion", () => {
  it("parses a plain stable version", () => {
    expect(parseVersion("1.2.3")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
      nightlyRun: null,
    });
  });

  it("strips a leading v and parses nightly run numbers", () => {
    expect(parseVersion("v0.1.0-nightly.562.1")).toMatchObject({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: "nightly.562.1",
      nightlyRun: 562,
    });
  });

  it("returns null for garbage", () => {
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });
});

describe("channelOf", () => {
  it("classifies stable vs nightly by tag shape", () => {
    expect(channelOf("1.2.3")).toBe("stable");
    expect(channelOf("0.1.0-nightly.562.1")).toBe("nightly");
  });
});

describe("compareVersions", () => {
  it("orders by core semver", () => {
    expect(compareVersions("1.2.0", "1.5.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("treats a prerelease as lower than its core release", () => {
    expect(compareVersions("1.0.0-nightly.5.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-nightly.5.1")).toBe(1);
  });

  it("orders nightlies by run number", () => {
    expect(
      compareVersions("0.1.0-nightly.10.1", "0.1.0-nightly.13.1"),
    ).toBe(-1);
  });
});

describe("countReleasesBehind", () => {
  const releases: ReleaseTag[] = [
    { tag_name: "v0.1.0-nightly.565.1" },
    { tag_name: "v0.1.0-nightly.564.1" },
    { tag_name: "v0.1.0-nightly.563.1" },
    { tag_name: "v0.1.0-nightly.562.1" },
    { tag_name: "v1.4.0" },
    { tag_name: "v1.3.0" },
    { tag_name: "v1.2.0" },
    { tag_name: "v0.1.0-nightly.561.1", draft: true },
  ];

  it("counts only newer releases on the active channel", () => {
    expect(countReleasesBehind(releases, "0.1.0-nightly.562.1", "nightly")).toBe(3);
    expect(countReleasesBehind(releases, "1.2.0", "stable")).toBe(2);
  });

  it("ignores drafts", () => {
    expect(countReleasesBehind(releases, "0.1.0-nightly.560.1", "nightly")).toBe(4);
  });

  it("returns 0 when already on the latest", () => {
    expect(countReleasesBehind(releases, "0.1.0-nightly.565.1", "nightly")).toBe(0);
    expect(countReleasesBehind(releases, "1.4.0", "stable")).toBe(0);
  });
});

describe("fallbackReleasesBehind", () => {
  it("uses the nightly run-number delta", () => {
    expect(
      fallbackReleasesBehind("0.1.0-nightly.562.1", "0.1.0-nightly.565.1"),
    ).toBe(3);
  });

  it("uses the patch delta within the same major.minor", () => {
    expect(fallbackReleasesBehind("1.2.0", "1.2.3")).toBe(3);
  });

  it("is indeterminate across minor/major gaps", () => {
    expect(fallbackReleasesBehind("1.2.0", "1.5.0")).toBeNull();
    expect(fallbackReleasesBehind("1.2.0", "2.0.0")).toBeNull();
  });

  it("returns 0 when not actually behind", () => {
    expect(fallbackReleasesBehind("1.2.3", "1.2.3")).toBe(0);
    expect(fallbackReleasesBehind("1.2.3", "1.2.0")).toBe(0);
  });
});

describe("parseGithubRepo", () => {
  it("derives owner/repo from a GitHub Pages base URL", () => {
    expect(parseGithubRepo("https://cypher-asi.github.io/aura-os")).toEqual({
      owner: "cypher-asi",
      repo: "aura-os",
    });
    expect(parseGithubRepo("https://n3o.github.io/aura-app/")).toEqual({
      owner: "n3o",
      repo: "aura-app",
    });
  });

  it("returns null for non-Pages or empty URLs", () => {
    expect(parseGithubRepo("https://example.com/foo")).toBeNull();
    expect(parseGithubRepo("https://cypher-asi.github.io")).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
    expect(parseGithubRepo("not a url")).toBeNull();
  });
});
