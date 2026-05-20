/**
 * Phase 5 vitest for the support_id suffix parser. Pins the
 * contract the chat-side error bubble + breadcrumb store both
 * rely on:
 *
 * - Extracts a 12-hex id from the `(support_id=<...>)` suffix.
 * - Returns `null` (and the input verbatim) when the suffix is
 *   absent.
 * - Strips the suffix from the cleaned message, including any
 *   trailing whitespace.
 */

import { describe, it, expect } from "vitest";
import { extractSupportId } from "./support-id";

describe("extractSupportId", () => {
  it("returns null and the original message when no suffix is present", () => {
    expect(extractSupportId("plain error message")).toEqual({
      supportId: null,
      cleanedMessage: "plain error message",
    });
  });

  it("extracts a 12-hex support id and strips the suffix from the cleaned message", () => {
    const { supportId, cleanedMessage } = extractSupportId(
      "Turn timed out (support_id=abcdef012345)",
    );
    expect(supportId).toBe("abcdef012345");
    expect(cleanedMessage).toBe("Turn timed out");
  });

  it("tolerates trailing whitespace after the suffix", () => {
    const { supportId, cleanedMessage } = extractSupportId(
      "Stream stalled  (support_id=0123456789ab)   ",
    );
    expect(supportId).toBe("0123456789ab");
    expect(cleanedMessage).toBe("Stream stalled");
  });

  it("accepts a 6-char id (the shortest the parser allows)", () => {
    const { supportId, cleanedMessage } = extractSupportId(
      "Failure (support_id=abcdef)",
    );
    expect(supportId).toBe("abcdef");
    expect(cleanedMessage).toBe("Failure");
  });

  it("accepts a 32-char id (the widest the parser allows)", () => {
    const long = "a".repeat(32);
    const { supportId, cleanedMessage } = extractSupportId(
      `boom (support_id=${long})`,
    );
    expect(supportId).toBe(long);
    expect(cleanedMessage).toBe("boom");
  });

  it("ignores a malformed suffix (uppercase / non-hex chars)", () => {
    expect(extractSupportId("oops (support_id=ZZZZZZZZZZZZ)")).toEqual({
      supportId: null,
      cleanedMessage: "oops (support_id=ZZZZZZZZZZZZ)",
    });
    expect(extractSupportId("oops (support_id=abc-123-def)")).toEqual({
      supportId: null,
      cleanedMessage: "oops (support_id=abc-123-def)",
    });
  });

  it("ignores a suffix that isn't anchored to the end of the message", () => {
    expect(
      extractSupportId(
        "Mid-stream (support_id=abcdef012345) trailing text",
      ),
    ).toEqual({
      supportId: null,
      cleanedMessage:
        "Mid-stream (support_id=abcdef012345) trailing text",
    });
  });

  it("handles empty or non-string input safely", () => {
    expect(extractSupportId("")).toEqual({ supportId: null, cleanedMessage: "" });
    expect(
      extractSupportId(undefined as unknown as string),
    ).toEqual({ supportId: null, cleanedMessage: "" });
  });

  it("matches a suffix even without a leading space (the server normally stamps one, but the parser is tolerant)", () => {
    // `\s*` in the leading position of the suffix regex means the
    // parser accepts both ` (support_id=...)` and `(support_id=...)`.
    // Anchoring on `$` keeps it strictly trailing, which is the
    // shape the support workflow relies on.
    expect(extractSupportId("boom(support_id=abcdef012345)")).toEqual({
      supportId: "abcdef012345",
      cleanedMessage: "boom",
    });
  });
});
