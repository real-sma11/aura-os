import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { ContextUsageIndicator } from "./ContextUsageIndicator";
import type { ContextBreakdown } from "../../../../stores/context-usage-store";

function fixtureBreakdown(): ContextBreakdown {
  return {
    systemPromptTokens: 6_500,
    toolsTokens: 20_300,
    skillsTokens: 1_600,
    mcpTokens: 0,
    subagentsTokens: 941,
    conversationTokens: 71_800,
  };
}

describe("ContextUsageIndicator", () => {
  it("renders the rounded percentage as the inline trigger", () => {
    render(<ContextUsageIndicator utilization={0.42} />);
    expect(screen.getByRole("button", { name: /42%/ })).toBeInTheDocument();
  });

  // Legacy fallback path: when the harness doesn't emit a breakdown
  // (older builds, dev-loop, fresh hydrate before first turn), the
  // old Used/Total card must keep working so nothing regresses.
  it("falls back to the Used/Total card when breakdown is missing", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator utilization={0.25} estimatedTokens={50_000} />,
    );

    const trigger = screen.getByRole("button", { name: /25%/ });
    await user.hover(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("25% used");
    expect(dialog).toHaveTextContent("50,000 tokens");
    expect(dialog).toHaveTextContent("200,000 tokens");
  });

  it("hides token rows when estimatedTokens are missing", async () => {
    const user = userEvent.setup();
    render(<ContextUsageIndicator utilization={0.42} />);

    await user.hover(screen.getByRole("button", { name: /42%/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent("Used");
    expect(dialog).not.toHaveTextContent("Total");
    expect(dialog).toHaveTextContent(
      /Token counts appear after the next assistant turn/,
    );
  });

  it("renders a reset button that calls onNewSession", async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    render(
      <ContextUsageIndicator utilization={0.42} onNewSession={onNewSession} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Start new session" }),
    );
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it("pins the popover open after click", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator utilization={0.42} estimatedTokens={10_000} />,
    );

    const trigger = screen.getByRole("button", { name: /42%/ });
    await user.click(trigger);
    await user.unhover(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Breakdown path mirrors the screenshot exactly: header + percent /
  // tokens summary + per-bucket list. MCP must be hidden when zero so
  // existing layouts stay stable until the harness gains MCP support.
  it("renders the breakdown popover with all populated buckets", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator
        utilization={0.39}
        estimatedTokens={105_141}
        breakdown={fixtureBreakdown()}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /39%/ }));

    const dialog = await screen.findByRole("dialog", { name: /context breakdown/i });
    expect(dialog).toHaveTextContent("Context");
    expect(dialog).toHaveTextContent("39% Full");
    expect(dialog).toHaveTextContent(/~105K \/ 270K Tokens/);

    expect(dialog).toHaveTextContent("System prompt");
    expect(dialog).toHaveTextContent("Tools");
    expect(dialog).toHaveTextContent("Skills");
    expect(dialog).toHaveTextContent("Subagents");
    expect(dialog).toHaveTextContent("Conversation");
    // MCP bucket is reserved (always 0 today); hide the row entirely
    // until the harness gains MCP support.
    expect(dialog).not.toHaveTextContent("MCP");
  });

  it("closes the breakdown popover when the close button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator
        utilization={0.39}
        estimatedTokens={105_141}
        breakdown={fixtureBreakdown()}
      />,
    );

    // Click pins the popover open (also exercises the click-outside
    // path indirectly — `unhover` shouldn't dismiss a pinned popover).
    await user.click(screen.getByRole("button", { name: /39%/ }));
    expect(
      screen.getByRole("dialog", { name: /context breakdown/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /close context breakdown/i }),
    );
    expect(
      screen.queryByRole("dialog", { name: /context breakdown/i }),
    ).not.toBeInTheDocument();
  });
});
