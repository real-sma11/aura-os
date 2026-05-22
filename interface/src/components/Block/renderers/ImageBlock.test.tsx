import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageBlock } from "./ImageBlock";
import type { ToolCallEntry } from "../../../shared/types/stream";
import {
  GalleryProvider,
  SessionGalleryContext,
  type GalleryItem,
} from "../../Gallery";

vi.mock("./renderers.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../Block.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

const mockOpenGallery = vi.fn();

vi.mock("../../Gallery/use-gallery", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useGallery: () => ({
      openGallery: mockOpenGallery,
      closeGallery: vi.fn(),
    }),
  };
});

function entry(
  result: Record<string, unknown>,
  overrides: Partial<ToolCallEntry> = {},
): ToolCallEntry {
  return {
    id: "gen-1",
    name: "generate_image",
    input: {},
    result: JSON.stringify(result),
    pending: false,
    ...overrides,
  };
}

describe("ImageBlock", () => {
  afterEach(() => {
    mockOpenGallery.mockReset();
  });

  it("renders artifact-style assetUrl results", () => {
    render(
      <ImageBlock
        entry={entry({
          assetUrl: "https://cdn.example.com/cat.png",
          originalUrl: "https://cdn.example.com/cat-original.png",
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/cat.png",
    );
    // The image is wrapped in a button that opens the shared gallery
    // overlay rather than navigating away in a new tab.
    expect(
      screen.getByRole("button", { name: /open generated image in gallery/i }),
    ).toBeInTheDocument();
  });

  it("renders nested payload asset_url results", () => {
    render(
      <ImageBlock
        entry={entry({
          payload: {
            asset_url: "https://cdn.example.com/nested-cat.png",
          },
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/nested-cat.png",
    );
  });

  it("opens the gallery with the session-wide list when the context is populated", () => {
    const sessionItems: GalleryItem[] = [
      { id: "prev-tc", src: "https://cdn/prev.png", alt: "earlier" },
      {
        id: "gen-1",
        src: "https://cdn.example.com/cat.png",
        alt: "Generated image",
        downloadUrl: "https://cdn.example.com/cat-original.png",
      },
      { id: "next-tc", src: "https://cdn/next.png", alt: "later" },
    ];
    render(
      <GalleryProvider>
        <SessionGalleryContext.Provider value={sessionItems}>
          <ImageBlock
            entry={entry({
              assetUrl: "https://cdn.example.com/cat.png",
              originalUrl: "https://cdn.example.com/cat-original.png",
            })}
          />
        </SessionGalleryContext.Provider>
      </GalleryProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /open generated image in gallery/i }),
    );
    expect(mockOpenGallery).toHaveBeenCalledTimes(1);
    expect(mockOpenGallery).toHaveBeenCalledWith({
      items: sessionItems,
      initialId: "gen-1",
    });
  });

  it("falls back to a single-item list when the entry is not in the session context", () => {
    // Defensive: a transient render race where the bubble paints
    // before `collectSessionImages` re-runs would leave the click
    // target missing from the published list. The click still has
    // to open *something* — verify the old single-item behavior
    // kicks in instead of silently swallowing the click.
    const sessionItems: GalleryItem[] = [
      { id: "other-tc", src: "https://cdn/other.png", alt: "other" },
    ];
    render(
      <GalleryProvider>
        <SessionGalleryContext.Provider value={sessionItems}>
          <ImageBlock
            entry={entry({
              assetUrl: "https://cdn.example.com/cat.png",
            })}
          />
        </SessionGalleryContext.Provider>
      </GalleryProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /open generated image in gallery/i }),
    );
    expect(mockOpenGallery).toHaveBeenCalledTimes(1);
    const callArg = mockOpenGallery.mock.calls[0][0];
    expect(callArg.initialId).toBe("gen-1");
    expect(callArg.items).toHaveLength(1);
    expect(callArg.items[0]).toMatchObject({
      id: "gen-1",
      src: "https://cdn.example.com/cat.png",
    });
  });
});
