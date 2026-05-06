import { describe, expect, it } from "vitest";
import {
  deriveSessionLabel,
  NEW_CHAT_PLACEHOLDER,
  truncate,
} from "./session-row-utils";
import type { AnnotatedSession } from "./session-row-utils";

function fixture(summary: string): AnnotatedSession {
  return {
    session_id: "s",
    started_at: new Date().toISOString(),
    summary_of_previous_context: summary,
    _projectName: "p",
    _projectId: "pid",
    _agentInstanceId: "aid",
  } as unknown as AnnotatedSession;
}

describe("truncate (markdown-aware)", () => {
  it("strips leading ATX heading markers", () => {
    expect(truncate("# Session Summary", 80)).toBe("Session Summary");
    expect(truncate("### Session Summary", 80)).toBe("Session Summary");
  });

  it("strips trailing ATX hashes alongside leading ones", () => {
    expect(truncate("# Title #", 80)).toBe("Title");
  });

  it("strips list markers", () => {
    expect(truncate("- first item", 80)).toBe("first item");
    expect(truncate("* first item", 80)).toBe("first item");
    expect(truncate("1. first item", 80)).toBe("first item");
  });

  it("strips wrapping bold and italic", () => {
    expect(truncate("**Important**", 80)).toBe("Important");
    expect(truncate("__Important__", 80)).toBe("Important");
    expect(truncate("*hi*", 80)).toBe("hi");
    expect(truncate("_hi_", 80)).toBe("hi");
  });

  it("falls through blank/heading-only first lines to the next visible line", () => {
    expect(truncate("# Session Summary\nWorked on auth refactor.", 80)).toBe(
      "Session Summary",
    );
    // When the heading itself is empty after strip, prefer the next
    // line so the row label isn't blank.
    expect(truncate("#\nFixed the chat panel.", 80)).toBe("Fixed the chat panel.");
  });

  it("leaves non-markdown text untouched", () => {
    expect(truncate("Just some text", 80)).toBe("Just some text");
  });

  it("truncates with an ellipsis once over the cap", () => {
    const long = "a".repeat(100);
    const out = truncate(long, 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("deriveSessionLabel", () => {
  it("uses the persisted summary with markdown stripped", () => {
    expect(deriveSessionLabel(fixture("# Agent Coding Session Summary"), undefined))
      .toBe("Agent Coding Session Summary");
  });

  it("returns the 'New chat' placeholder when there is no summary", () => {
    expect(deriveSessionLabel(fixture(""), undefined)).toBe(NEW_CHAT_PLACEHOLDER);
  });

  it("returns the placeholder when both persisted and fetched summaries are blank", () => {
    expect(deriveSessionLabel(fixture(""), "")).toBe(NEW_CHAT_PLACEHOLDER);
    expect(deriveSessionLabel(fixture("   "), "  ")).toBe(NEW_CHAT_PLACEHOLDER);
  });

  it("upgrades from the placeholder to a real summary when one becomes available", () => {
    const session = fixture("");
    expect(deriveSessionLabel(session, undefined)).toBe(NEW_CHAT_PLACEHOLDER);
    expect(deriveSessionLabel(session, "Investigating zero-sdk auth flow")).toBe(
      "Investigating zero-sdk auth flow",
    );
  });

  it("prefers the persisted summary over a fetched fallback", () => {
    expect(deriveSessionLabel(fixture("# Persisted"), "Fetched")).toBe("Persisted");
  });

  it("falls back to the fetched summary when the persisted one is blank", () => {
    expect(deriveSessionLabel(fixture(""), "# Fetched")).toBe("Fetched");
  });
});
