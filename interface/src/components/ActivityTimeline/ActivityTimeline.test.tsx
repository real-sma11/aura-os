import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityTimeline } from "./ActivityTimeline";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";

// CSS modules are not loaded under vitest; provide identity proxies so the
// rendered class names stay readable in queries.
vi.mock("./ActivityTimeline.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../Block/Block.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../Block/ThinkingBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../CopyButton/CopyButton.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("ActivityTimeline thinking segments", () => {
  // Regression: when a multi-segment turn renders (thinking -> tool ->
  // thinking), only the trailing live segment should show "Thinking..."
  // / shimmer / forced-expand. Earlier segments are already closed by
  // `closeCurrentThinkingSegment` (they carry `durationMs`) and must
  // render as "Thought for X" and start collapsed.
  it("only the open thinking segment shows 'Thinking...' during a live multi-segment turn", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "a.ts" },
        result: "ok",
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      {
        kind: "thinking",
        id: "th-1",
        text: "first thoughts",
        startMs: 1000,
        durationMs: 1500,
      },
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      {
        kind: "thinking",
        id: "th-2",
        text: "second thoughts streaming",
        startMs: 5000,
      },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        isStreaming
      />,
    );

    // Closed first segment should render as "Thought for X" (not
    // "Thinking..."). The exact formatted duration is owned by
    // `formatDuration`; we only assert the prefix here.
    expect(screen.getByText(/^Thought for/)).toBeInTheDocument();

    // Exactly one "Thinking..." label - the trailing open segment.
    const thinkingLabels = screen.getAllByText("Thinking...");
    expect(thinkingLabels).toHaveLength(1);

    // The closed segment's block must NOT be force-expanded (i.e. it
    // starts collapsed since `defaultThinkingExpanded` is undefined and
    // its derived `isStreaming` is false). The open segment's block IS
    // force-expanded.
    const expandableHeaders = screen
      .getAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    const expandedCount = expandableHeaders.filter(
      (el) => el.getAttribute("aria-expanded") === "true",
    ).length;
    // 1 open thinking block (force-expanded) + 0 collapsed thinking block
    // visible as expanded + tool block collapsed = 1 expanded total.
    expect(expandedCount).toBe(1);
  });

  // Once the turn finishes, no thinking segment is streaming so neither
  // block should show "Thinking..." and both should render as
  // "Thought for X" (or "Thought" without a duration).
  it("after streaming ends, no thinking segment shows 'Thinking...'", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "thinking",
        id: "th-1",
        text: "first thoughts",
        durationMs: 1500,
      },
      {
        kind: "thinking",
        id: "th-2",
        text: "second thoughts",
        durationMs: 2200,
      },
    ];

    render(
      <ActivityTimeline timeline={timeline} isStreaming={false} />,
    );

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });
});
