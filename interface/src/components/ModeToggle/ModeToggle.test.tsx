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
    expect(screen.getByRole("button", { name: "Normie" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advanced" }),
    ).toBeInTheDocument();
  });

  it("reflects the store's active mode via aria-pressed", () => {
    useUIModeStore.setState({ mode: "normie" });
    render(<ModeToggle />);
    expect(
      screen.getByRole("button", { name: "Normie", pressed: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advanced", pressed: false }),
    ).toBeInTheDocument();
  });

  it("flips the store when a segment is clicked", async () => {
    const user = userEvent.setup();
    render(<ModeToggle />);

    expect(useUIModeStore.getState().mode).toBe("advanced");
    await user.click(screen.getByRole("button", { name: "Normie" }));
    expect(useUIModeStore.getState().mode).toBe("normie");
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(useUIModeStore.getState().mode).toBe("advanced");
  });
});
