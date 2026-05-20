/**
 * Phase 5 helper: extract the server-stamped `support_id` suffix
 * from an `ErrorMsg` body.
 *
 * Phase 3 stamps every server-side `ErrorMsg.message` with a
 * trailing ` (support_id=<12hex>)` so the chat-side error bubble
 * can show a copyable chip that joins back to the matching
 * `tracing` span on the server. This helper does the inverse: pull
 * the id out and return it alongside the cleaned message body so
 * the bubble's prose stays readable.
 *
 * The pattern is tolerant of:
 *   - leading whitespace before the suffix (e.g. when the server
 *     has already added a trailing space)
 *   - trailing whitespace after the suffix
 *   - hex strings between 6 and 32 chars (the server emits exactly
 *     12 today, but the wider window keeps the parser tolerant of
 *     a future bump without needing a coordinated client release)
 *
 * Returns `{ supportId: null, cleanedMessage: text }` when no
 * suffix is present so the caller can use the same render branch
 * for both shapes.
 */
export interface SupportIdExtraction {
  supportId: string | null;
  cleanedMessage: string;
}

const SUPPORT_ID_SUFFIX_RE = /\s*\(support_id=([0-9a-f]{6,32})\)\s*$/;

export function extractSupportId(text: string): SupportIdExtraction {
  if (typeof text !== "string" || text.length === 0) {
    return { supportId: null, cleanedMessage: text ?? "" };
  }
  const match = SUPPORT_ID_SUFFIX_RE.exec(text);
  if (!match) {
    return { supportId: null, cleanedMessage: text };
  }
  // `match.index` is the start of the leading whitespace inside
  // the suffix capture, so slicing up to it strips both the
  // `(support_id=...)` chunk and any whitespace immediately
  // before it. `trimEnd` is a belt-and-braces guard for cases
  // where the message body itself ended with trailing
  // whitespace before the suffix was appended.
  return {
    supportId: match[1],
    cleanedMessage: text.slice(0, match.index).trimEnd(),
  };
}
