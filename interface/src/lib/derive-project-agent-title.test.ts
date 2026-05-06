import { describe, expect, it } from "vitest";
import {
  agentDisplayName,
  deriveProjectAgentTitle,
  FALLBACK_AGENT_NAME,
} from "./derive-project-agent-title";

describe("agentDisplayName", () => {
  it("returns the trimmed name when one is present", () => {
    expect(agentDisplayName("Rose")).toBe("Rose");
    expect(agentDisplayName("  Rose  ")).toBe("Rose");
  });

  it("falls back to 'New Agent' when the name is missing", () => {
    expect(agentDisplayName(undefined)).toBe(FALLBACK_AGENT_NAME);
    expect(agentDisplayName(null)).toBe(FALLBACK_AGENT_NAME);
  });

  it("falls back to 'New Agent' when the name is blank", () => {
    expect(agentDisplayName("")).toBe(FALLBACK_AGENT_NAME);
    expect(agentDisplayName("   ")).toBe(FALLBACK_AGENT_NAME);
    expect(agentDisplayName("\t\n")).toBe(FALLBACK_AGENT_NAME);
  });
});

describe("deriveProjectAgentTitle", () => {
  it("returns the default title for blank prompts", () => {
    expect(deriveProjectAgentTitle("   ")).toBe("New Agent");
  });

  it("strips conversational lead-ins and produces a short title", () => {
    expect(
      deriveProjectAgentTitle("Can you fix the navbar spacing on mobile and add tests?"),
    ).toBe("Fix Navbar Spacing Mobile Tests");
  });

  it("uses the first non-empty line of a prompt", () => {
    expect(
      deriveProjectAgentTitle("\n\nBuild a checkout polling hook for billing.\nThen add tests."),
    ).toBe("Build Checkout Polling Hook Billing");
  });

  it("removes slash commands and urls", () => {
    expect(
      deriveProjectAgentTitle("/plan update the docs for https://example.com/api first"),
    ).toBe("Update Docs First");
  });
});
