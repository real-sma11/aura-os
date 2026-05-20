import { render, screen } from "../../test/render";
import type { LoopActivityPayload } from "../../shared/types/aura-events";
import { LoopProgress } from "./LoopProgress";

function activity(overrides: Partial<LoopActivityPayload> = {}): LoopActivityPayload {
  return {
    status: "running",
    percent: null,
    started_at: "2026-04-24T00:00:00.000Z",
    last_event_at: "2026-04-24T00:00:01.000Z",
    current_task_id: "task-1",
    ...overrides,
  };
}

function progressArc(svg: SVGElement): Element {
  const arc = svg.querySelector('circle[stroke-linecap="round"]');
  if (!arc) {
    throw new Error("Expected LoopProgress to render a foreground arc");
  }
  return arc;
}

describe("LoopProgress", () => {
  it("renders a visible spinning arc for active loops at zero percent", () => {
    render(<LoopProgress source={{ activity: activity({ percent: 0 }) }} />);

    const svg = screen.getByRole("img", { name: "running 0%" });
    const arc = progressArc(svg);

    expect(arc).not.toHaveAttribute(
      "stroke-dashoffset",
      arc.getAttribute("stroke-dasharray"),
    );
    expect(arc).not.toHaveAttribute("transform");
  });

  it("uses the same visible arc for indeterminate active loops", () => {
    render(<LoopProgress source={{ activity: activity({ percent: null }) }} />);

    const svg = screen.getByRole("img", { name: "running" });
    const arc = progressArc(svg);

    expect(arc).not.toHaveAttribute(
      "stroke-dashoffset",
      arc.getAttribute("stroke-dasharray"),
    );
  });

  it("does not render terminal loops", () => {
    const { container } = render(
      <LoopProgress source={{ activity: activity({ status: "completed", percent: 1 }) }} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
