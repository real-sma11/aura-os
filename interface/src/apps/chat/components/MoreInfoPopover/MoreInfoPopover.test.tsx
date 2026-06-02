import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoreInfoPopover } from "./MoreInfoPopover";

describe("MoreInfoPopover", () => {
  const meta = {
    sessionId: "s-123",
    projectName: "Demo Project",
    workspacePath: "/home/user/demo",
  };

  it("renders the session, project, and workspace metadata", () => {
    render(<MoreInfoPopover meta={meta} onClose={() => {}} />);
    expect(screen.getByText("s-123")).toBeInTheDocument();
    expect(screen.getByText("Demo Project")).toBeInTheDocument();
    expect(screen.getByText("/home/user/demo")).toBeInTheDocument();
  });

  it("falls back to an em dash for missing values", () => {
    render(
      <MoreInfoPopover
        meta={{ sessionId: null, projectName: "", workspacePath: null }}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<MoreInfoPopover meta={meta} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
