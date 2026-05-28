import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchDesktopManifest,
  getDesktopManifestUrl,
  resolveAutoDownloadUrl,
  type DesktopManifest,
} from "./desktop-manifest";

const SAMPLE_MANIFEST: DesktopManifest = {
  channel: "nightly",
  version: "0.1.0-nightly.562.1",
  release_url:
    "https://github.com/cypher-asi/aura-os/releases/tag/nightly-562.1",
  desktop: {
    windows: {
      url: "https://github.com/cypher-asi/aura-os/releases/download/nightly-562.1/aura-os-desktop_0.1.0_x64-setup.exe",
    },
    linux: {
      url: "https://github.com/cypher-asi/aura-os/releases/download/nightly-562.1/aura-os-desktop_0.1.0_x86_64.AppImage",
    },
    mac: {
      "apple-silicon": {
        url: "https://github.com/cypher-asi/aura-os/releases/download/nightly-562.1/AURA_0.1.0_aarch64.dmg",
      },
      intel: {
        url: "https://github.com/cypher-asi/aura-os/releases/download/nightly-562.1/AURA_0.1.0_x64.dmg",
      },
    },
  },
};

const originalFetch = globalThis.fetch;

describe("getDesktopManifestUrl", () => {
  it("returns the channel-specific manifest URL", () => {
    expect(getDesktopManifestUrl("nightly")).toBe(
      "https://cypher-asi.github.io/aura-os/downloads/nightly.json",
    );
    expect(getDesktopManifestUrl("stable")).toBe(
      "https://cypher-asi.github.io/aura-os/downloads/stable.json",
    );
  });
});

describe("fetchDesktopManifest", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the parsed manifest on 200", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_MANIFEST), { status: 200 }),
    );

    const manifest = await fetchDesktopManifest("nightly");
    expect(manifest?.version).toBe("0.1.0-nightly.562.1");
    expect(manifest?.desktop?.windows?.url).toContain("x64-setup.exe");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cypher-asi.github.io/aura-os/downloads/nightly.json",
      expect.any(Object),
    );
  });

  it("returns undefined on a non-OK response", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(fetchDesktopManifest("nightly")).resolves.toBeUndefined();
  });

  it("returns undefined when fetch throws", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(fetchDesktopManifest("nightly")).resolves.toBeUndefined();
  });
});

describe("resolveAutoDownloadUrl", () => {
  it("returns the direct installer for Windows / Linux", () => {
    expect(resolveAutoDownloadUrl(SAMPLE_MANIFEST, "windows", null)).toBe(
      SAMPLE_MANIFEST.desktop!.windows!.url,
    );
    expect(resolveAutoDownloadUrl(SAMPLE_MANIFEST, "linux", null)).toBe(
      SAMPLE_MANIFEST.desktop!.linux!.url,
    );
  });

  it("falls back to the manifest release page for Mac (no JS-level arch detection)", () => {
    expect(resolveAutoDownloadUrl(SAMPLE_MANIFEST, "mac", null)).toBe(
      SAMPLE_MANIFEST.release_url,
    );
  });

  it("falls back to the release URL for unknown platforms", () => {
    expect(resolveAutoDownloadUrl(SAMPLE_MANIFEST, "unknown", null)).toBe(
      SAMPLE_MANIFEST.release_url,
    );
  });

  it("uses the entry release URL when the manifest is unavailable", () => {
    const url = "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0";
    expect(resolveAutoDownloadUrl(undefined, "windows", url)).toBe(url);
  });

  it("returns undefined when nothing is available", () => {
    expect(resolveAutoDownloadUrl(undefined, "windows", null)).toBeUndefined();
  });
});
