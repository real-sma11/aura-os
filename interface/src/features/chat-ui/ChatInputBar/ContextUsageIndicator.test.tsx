import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { ContextUsageIndicator } from "./ContextUsageIndicator";
import type { ContextBreakdown } from "../../../stores/context-usage-store";

function fixtureBreakdown(): ContextBreakdown {
  return {
    systemPromptTokens: 6_500,
    toolsTokens: 20_300,
    skillsTokens: 1_600,
    mcpTokens: 0,
    subagentsTokens: 941,
    conversationTokens: 71_800,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

describe("ContextUsageIndicator", () => {
  it("renders the rounded percentage as the inline trigger", () => {
    render(<ContextUsageIndicator utilization={0.42} />);
    expect(
      screen.getByRole("button", { name: /42% context/i }),
    ).toBeInTheDocument();
  });

  // The ring is the only piece of the trigger that visually communicates
  // utilization at a glance, so guarantee it (a) exposes an accessible
  // label that names the percentage and (b) renders an arc whose
  // dashoffset reflects the fraction filled rather than the empty
  // (0%) or full (100%) edge case.
  it("renders an SVG ring with an accessible label and dashoffset reflecting utilization", () => {
    const { container } = render(<ContextUsageIndicator utilization={0.45} />);

    const ring = screen.getByRole("img", { name: /Context: 45% used/i });
    expect(ring.tagName.toLowerCase()).toBe("svg");

    const progress = container.querySelector(".contextIndicatorRingProgress");
    expect(progress).not.toBeNull();
    const dashArray = Number(progress?.getAttribute("stroke-dasharray"));
    const dashOffset = Number(progress?.getAttribute("stroke-dashoffset"));
    expect(dashArray).toBeGreaterThan(0);
    expect(dashOffset).toBeGreaterThan(0);
    expect(dashOffset).toBeLessThan(dashArray);

    // Label must be the lowercase "NN% context" form per the screenshot.
    const trigger = screen.getByRole("button", { name: /45% context/i });
    expect(trigger.textContent).toMatch(/\b45% context\b/);
    expect(trigger.textContent).not.toMatch(/Context\b/);
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
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("25% used");
    expect(dialog).toHaveTextContent("50,000 tokens");
    expect(dialog).toHaveTextContent("200,000 tokens");
  });

  it("hides token rows when estimatedTokens are missing", async () => {
    const user = userEvent.setup();
    render(<ContextUsageIndicator utilization={0.42} />);

    await user.click(screen.getByRole("button", { name: /42%/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent("Used");
    expect(dialog).not.toHaveTextContent("Total");
    expect(dialog).toHaveTextContent(
      /Token counts appear after the next assistant turn/,
    );
  });

  // The indicator sits on the chat input bar; opening on hover would
  // cover the composer during stray pointer moves, so the panel must
  // only open in response to a click.
  it("does not open the popover on hover", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator utilization={0.42} estimatedTokens={10_000} />,
    );

    const trigger = screen.getByRole("button", { name: /42%/ });
    await user.hover(trigger);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles the popover open and closed on click", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator utilization={0.42} estimatedTokens={10_000} />,
    );

    const trigger = screen.getByRole("button", { name: /42%/ });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
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

    await user.click(screen.getByRole("button", { name: /39%/ }));

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
