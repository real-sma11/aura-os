import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyImageToClipboard, getImageTarget } from "./image-target";

function createImage(src = "data:image/png;base64,AAAA"): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  // jsdom doesn't decode the bitmap, so naturalWidth/Height stay 0 unless
  // we fake them. The canvas fallback path needs both to be > 0.
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: 16 });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: 16 });
  document.body.appendChild(img);
  return img;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getImageTarget", () => {
  it("returns the image when the target is itself an <img>", () => {
    const img = createImage();
    expect(getImageTarget(img)).toBe(img);
  });

  it("returns the closest <img> for a target nested inside one", () => {
    // <img> is a void element, but `closest` walks up from any HTMLElement,
    // so the realistic case is a thumbnail-wrapping button. The wrapper
    // shouldn't match — only a direct image right-click should.
    const button = document.createElement("button");
    const img = createImage();
    button.appendChild(img);
    document.body.appendChild(button);
    expect(getImageTarget(button)).toBeNull();
    expect(getImageTarget(img)).toBe(img);
  });

  it("returns null for non-image elements", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(getImageTarget(div)).toBeNull();
  });

  it("returns null for non-element targets", () => {
    expect(getImageTarget(null)).toBeNull();
    const text = document.createTextNode("hi");
    document.body.appendChild(text);
    expect(getImageTarget(text)).toBeNull();
  });

  it("skips images flagged with data-no-copy", () => {
    const img = createImage();
    img.dataset.noCopy = "";
    expect(getImageTarget(img)).toBeNull();
  });
});

interface ClipboardWriteSpy {
  write: ReturnType<typeof vi.fn>;
}

function installClipboardStub(): ClipboardWriteSpy {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { write },
    writable: true,
    configurable: true,
  });
  return { write };
}

function installClipboardItemStub(): void {
  // jsdom doesn't ship ClipboardItem. Stub a minimal constructor that
  // remembers the payload so assertions can inspect it.
  class FakeClipboardItem {
    public readonly types: string[];
    public readonly data: Record<string, Blob>;
    constructor(data: Record<string, Blob>) {
      this.data = data;
      this.types = Object.keys(data);
    }
  }
  (globalThis as unknown as { ClipboardItem: typeof ClipboardItem }).ClipboardItem =
    FakeClipboardItem as unknown as typeof ClipboardItem;
}

function clearClipboardItemStub(): void {
  delete (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
}

// jsdom's `Response` requires `blob.stream()` (not implemented by its
// Blob polyfill), so we hand-roll a minimal Fetch result that satisfies
// what `fetchAsBlob` reads: `ok` and `blob()`.
function fakeFetchResponse(blob: Blob | null): { ok: boolean; blob: () => Promise<Blob> } {
  if (!blob) {
    return { ok: false, blob: () => Promise.reject(new Error("no blob")) };
  }
  return { ok: true, blob: () => Promise.resolve(blob) };
}

describe("copyImageToClipboard", () => {
  beforeEach(() => {
    installClipboardItemStub();
  });

  afterEach(() => {
    clearClipboardItemStub();
    vi.restoreAllMocks();
  });

  it("returns false when ClipboardItem is unavailable", async () => {
    clearClipboardItemStub();
    installClipboardStub();
    const img = createImage();
    expect(await copyImageToClipboard(img)).toBe(false);
  });

  it("returns false when navigator.clipboard.write is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const img = createImage();
    expect(await copyImageToClipboard(img)).toBe(false);
  });

  it("writes the fetched PNG blob directly when fetch returns image/png", async () => {
    const { write } = installClipboardStub();
    const pngBlob = new Blob(["fake-png-bytes"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeFetchResponse(pngBlob)));

    const img = createImage("data:image/png;base64,AAAA");
    const ok = await copyImageToClipboard(img);

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] as [Array<{ types: string[]; data: Record<string, Blob> }>];
    expect(items).toHaveLength(1);
    expect(items[0].types).toEqual(["image/png"]);
    expect(items[0].data["image/png"].type).toBe("image/png");
  });

  it("re-encodes via canvas when fetch returns a non-PNG mime", async () => {
    const { write } = installClipboardStub();
    const jpegBlob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeFetchResponse(jpegBlob)));
    const reencoded = new Blob(["canvas-png"], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(reencoded);
    });

    const img = createImage("data:image/jpeg;base64,/9j/AA");
    const ok = await copyImageToClipboard(img);

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] as [Array<{ data: Record<string, Blob> }>];
    expect(items[0].data["image/png"]).toBe(reencoded);
  });

  it("falls back to canvas re-encoding when fetch fails (CORS-like)", async () => {
    const { write } = installClipboardStub();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("CORS")));
    const reencoded = new Blob(["canvas-png"], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(reencoded);
    });

    const img = createImage("https://example.test/cat.jpg");
    const ok = await copyImageToClipboard(img);

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("returns false when clipboard.write rejects", async () => {
    const { write } = installClipboardStub();
    write.mockRejectedValueOnce(new Error("permission denied"));
    const pngBlob = new Blob(["fake-png-bytes"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeFetchResponse(pngBlob)));

    const img = createImage();
    expect(await copyImageToClipboard(img)).toBe(false);
  });

  it("returns false when no blob can be produced", async () => {
    installClipboardStub();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("CORS")));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    const img = createImage("https://example.test/cat.jpg");
    expect(await copyImageToClipboard(img)).toBe(false);
  });
});
