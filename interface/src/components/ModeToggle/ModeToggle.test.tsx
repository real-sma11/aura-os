import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModeToggle } from "./ModeToggle";
import { useUIModeStore } from "../../stores/ui-mode-store";

beforeEach(() => {
  window.localStorage.clear();
  useUIModeStore.setState({ mode: "advanced" });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("ModeToggle", () => {
  it("renders both segments labelled Normie and Advanced", () => {
    render(<ModeToggle />);
    // Built on `SlidingPills`, so segments expose `role="radio"`
    // (matches the chat input ModeSelector for a consistent feel).
    expect(screen.getByRole("radio", { name: "Normie" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Advanced" })).toBeInTheDocument();
  });

  it("reflects the store's active mode via aria-checked", () => {
    useUIModeStore.setState({ mode: "normie" });
    render(<ModeToggle />);
    expect(
      screen.getByRole("radio", { name: "Normie", checked: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Advanced", checked: false }),
    ).toBeInTheDocument();
  });

  it("flips the store when a segment is clicked", async () => {
    const user = userEvent.setup();
    render(<ModeToggle />);

    expect(useUIModeStore.getState().mode).toBe("advanced");
    await user.click(screen.getByRole("radio", { name: "Normie" }));
    expect(useUIModeStore.getState().mode).toBe("normie");
    await user.click(screen.getByRole("radio", { name: "Advanced" }));
    expect(useUIModeStore.getState().mode).toBe("advanced");
  });

  it("exposes a single sliding indicator that tracks the active segment", () => {
    useUIModeStore.setState({ mode: "advanced" });
    const { container } = render(<ModeToggle />);
    const indicators = container.querySelectorAll(
      "[data-sliding-pills-indicator]",
    );
    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toHaveAttribute("data-active-id", "advanced");
  });
});
