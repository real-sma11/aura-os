import { useDeferredValue, useMemo } from "react";
import hljs from "highlight.js/lib/common";

const MAX_HIGHLIGHT_SIZE = 100_000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Syntax-highlight `code` with `highlight.js`. The work runs against a
 * `useDeferredValue`-deferred copy of `code` so that high-priority
 * renders (e.g. the chat panel revealing the cold-load thread, an
 * unrelated state update bubbling through the React tree) commit
 * without blocking on the highlighter. The deferred phase pays for
 * the actual `hljs.highlight*` call. On the very first render a
 * `useDeferredValue` initially returns the same input, so this is a
 * no-op for fresh mounts; the win is on updates and on cold opens
 * where many code blocks would otherwise contend for the same
 * commit phase.
 */
export function useHighlightedHtml(
  code: string,
  language?: string,
): string {
  const deferredCode = useDeferredValue(code);
  return useMemo(() => {
    if (!deferredCode) return "";
    if (deferredCode.length > MAX_HIGHLIGHT_SIZE) return escapeHtml(deferredCode);
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(deferredCode, { language }).value;
      }
      return hljs.highlightAuto(deferredCode).value;
    } catch {
      return escapeHtml(deferredCode);
    }
  }, [deferredCode, language]);
}
