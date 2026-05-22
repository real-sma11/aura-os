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
  it("renders both segments labelled Simple and Advanced", () => {
    render(<ModeToggle />);
    // Built on `SlidingPills`, so segments expose `role="radio"`
    // (matches the chat input ModeSelector for a consistent feel).
    expect(screen.getByRole("radio", { name: "Simple" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Advanced" })).toBeInTheDocument();
  });

  it("reflects the store's active mode via aria-checked", () => {
    useUIModeStore.setState({ mode: "simple" });
    render(<ModeToggle />);
    expect(
      screen.getByRole("radio", { name: "Simple", checked: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Advanced", checked: false }),
    ).toBeInTheDocument();
  });

  it("flips the store when a segment is clicked", async () => {
    const user = userEvent.setup();
    render(<ModeToggle />);

    expect(useUIModeStore.getState().mode).toBe("advanced");
    await user.click(screen.getByRole("radio", { name: "Simple" }));
    expect(useUIModeStore.getState().mode).toBe("simple");
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

  it("renders the indicator on 'simple' when the persisted mode is 'public' (logged-in stale)", () => {
    // The toggle never writes "public", but a stale localStorage
    // value or a logged-out store snapshot can land us here. The
    // indicator should still pick a valid segment instead of
    // collapsing.
    useUIModeStore.setState({ mode: "public" });
    const { container } = render(<ModeToggle />);
    const indicator = container.querySelector(
      "[data-sliding-pills-indicator]",
    );
    expect(indicator).toHaveAttribute("data-active-id", "simple");
  });
});
