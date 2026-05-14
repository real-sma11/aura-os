/**
 * Cross-platform clipboard helper.
 *
 * Prefers the async `navigator.clipboard.writeText` API (available on
 * modern desktop browsers and Capacitor WebViews on Android / iOS in
 * secure contexts). Falls back to a hidden `<textarea>` +
 * `document.execCommand("copy")` for older WebViews and non-secure
 * contexts where the async API is unavailable.
 *
 * Accepts either a plain string (legacy callers) or a
 * `{ plain, html }` payload. When both MIME types are provided we
 * write a single `ClipboardItem` so the OS clipboard exposes both
 * `text/plain` (Obsidian, terminals, code editors) and `text/html`
 * (Notion, Google Docs, mail clients) -- this is what makes
 * markdown survive a round-trip into Obsidian without losing `**bold**`
 * / `# headings` while still rendering as formatted text in rich
 * editors. If the dual-MIME path fails for any reason we degrade to
 * the plain-text path so the copy never silently no-ops.
 */
export type ClipboardPayload = string | { plain: string; html?: string };

export async function copyToClipboard(payload: ClipboardPayload): Promise<void> {
  const plain = typeof payload === "string" ? payload : payload.plain;
  const html = typeof payload === "string" ? undefined : payload.html;

  if (
    html
    && typeof ClipboardItem !== "undefined"
    && navigator.clipboard?.write
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain-text path -- e.g. permissions denied or
      // a WebView that lacks `ClipboardItem`. Better to land plain
      // markdown on the clipboard than nothing.
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(plain);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = plain;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
