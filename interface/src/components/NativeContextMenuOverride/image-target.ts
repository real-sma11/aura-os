/**
 * Detects whether a DOM event target is an image, plus a helper that
 * writes that image's bitmap to the OS clipboard. Used by the
 * `NativeContextMenuOverride` "image" menu so right-clicking any `<img>`
 * in AURA offers the same Copy Image action a native browser menu would.
 *
 * Copy strategy:
 *   1. Try to fetch the image as a blob (works for `data:`, `blob:`, and
 *      same-origin / CORS-enabled URLs).
 *   2. If the blob is already PNG, write it directly. Otherwise re-encode
 *      to PNG via an offscreen canvas — `ClipboardItem` is only required
 *      to accept `image/png`, and Safari/Firefox refuse anything else.
 *   3. Fall back to the canvas path if `fetch` fails (cross-origin,
 *      missing `crossorigin` attribute) — `drawImage` will still work
 *      whenever the browser already painted the bitmap, but will throw
 *      `SecurityError` on `toBlob` for tainted canvases. Failures are
 *      swallowed and reported via the boolean return so callers can
 *      decide what (if anything) to surface.
 */

const PNG_MIME = "image/png";

export function getImageTarget(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null;
  const img = target.closest<HTMLImageElement>("img");
  if (!img) return null;
  // Escape hatch for any caller that wants to keep an `<img>` out of the
  // copy menu (e.g. a decorative icon). Not used today, but cheap.
  if (img.dataset.noCopy != null) return null;
  return img;
}

async function blobFromCanvas(img: HTMLImageElement): Promise<Blob | null> {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, width, height);
  } catch {
    return null;
  }

  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), PNG_MIME);
    } catch {
      resolve(null);
    }
  });
}

async function fetchAsBlob(src: string): Promise<Blob | null> {
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

async function resolvePngBlob(img: HTMLImageElement): Promise<Blob | null> {
  const src = img.currentSrc || img.src;
  if (src) {
    const fetched = await fetchAsBlob(src);
    if (fetched && fetched.type === PNG_MIME) {
      return fetched;
    }
    // Non-PNG bytes (jpeg/webp/gif): re-encode via canvas. We re-paint
    // the live `<img>` rather than the fetched blob so we don't have to
    // wait on a second decode round-trip.
  }
  return blobFromCanvas(img);
}

export async function copyImageToClipboard(img: HTMLImageElement): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }

  const blob = await resolvePngBlob(img);
  if (!blob) return false;

  try {
    await navigator.clipboard.write([new ClipboardItem({ [PNG_MIME]: blob })]);
    return true;
  } catch {
    return false;
  }
}
