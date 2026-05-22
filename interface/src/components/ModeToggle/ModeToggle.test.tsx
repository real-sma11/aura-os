import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModeToggle } from "./ModeToggle";
import { useUIModeStore } from "../../stores/ui-mode-store";
import { useAuthStore } from "../../stores/auth-store";

const TEST_USER = {
  user_id: "test-user",
  network_user_id: "test-net",
  profile_id: "test-prof",
  display_name: "Test",
  profile_image: null,
  primary_zid: null,
  zero_wallet: null,
  wallets: [],
  is_zero_pro: false,
  is_access_granted: true,
} as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>;

beforeEach(() => {
  window.localStorage.clear();
  useUIModeStore.setState({ mode: "advanced" });
  // Mark the test user as logged-in so `useEffectiveMode()` does not
  // squash to `"public"` (which would render the toggle inert and
  // intercept `userEvent` clicks).
  useAuthStore.setState({ user: TEST_USER });
});

afterEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ user: null });
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

  it("renders as aria-disabled with pointer-events:none in public (logged-out) effective mode", () => {
    // `useEffectiveMode()` returns `"public"` whenever the user is
    // logged out, regardless of the persisted `mode`. The pill stays
    // mounted but is rendered inert so clicks / focus don't reach
    // the radio buttons.
    useAuthStore.setState({ user: null });
    const { container } = render(<ModeToggle />);
    const wrapper = container.querySelector(
      "[data-agent-surface='ui-mode-toggle']",
    ) as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute("aria-disabled", "true");
    expect(wrapper?.style.pointerEvents).toBe("none");
  });

  // Phase 3 regression — the load-bearing invariant: when `mode` flips
  // Simple <-> Advanced, the indicator DOM node must (a) stay the same
  // element instance (no remount) and (b) re-run its CSS transform
  // transition without writing `transition: 'none'` (which is the
  // initial-mount / ResizeObserver snap path). `SlidingPills.tsx`
  // tracks user-driven flips via `lastAppliedValueRef`; a remount
  // would reset that ref and force a snap, killing the slide.
  //
  // jsdom does not compute layout, so `getBoundingClientRect()`
  // returns all zeros by default and the inline `transform` stays at
  // `translate(0px, 0px)` for both segments. We monkey-patch
  // `getBoundingClientRect` per-segment so the two pills resolve to
  // distinguishable geometries and the indicator's `transform` write
  // produces a visible delta on flip.
  it("slides — not snaps — the indicator when mode flips while staying mounted", async () => {
    const originalGetRect = HTMLElement.prototype.getBoundingClientRect;
    // Each segment claims a 40px slot; the container starts at x=0.
    // Simple sits at x=0, Advanced at x=40 — so the indicator
    // transform should move from `translate(0px, 0px)` to
    // `translate(40px, 0px)` on the user-driven flip.
    HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
      const segment = this.getAttribute("data-sliding-pills-item");
      if (segment === "simple") {
        return new DOMRect(0, 0, 40, 24);
      }
      if (segment === "advanced") {
        return new DOMRect(40, 0, 40, 24);
      }
      // Container (radiogroup) and indicator pin to the origin so the
      // segment x-deltas above turn into pure indicator transforms.
      return new DOMRect(0, 0, 80, 24);
    };

    try {
      useUIModeStore.setState({ mode: "simple" });
      const { rerender } = render(<ModeToggle />);
      const indicatorBefore = screen.getByTestId("ui-mode-indicator");
      const transformBefore = indicatorBefore.style.transform;
      // Initial mount uses the snap path (`transition: 'none'`); we
      // capture the transform but do NOT assert against `transition`
      // here — the slide assertion runs against the post-flip apply.
      expect(transformBefore).toBe("translate(0px, 0px)");

      await act(async () => {
        useUIModeStore.setState({ mode: "advanced" });
      });
      rerender(<ModeToggle />);

      const indicatorAfter = screen.getByTestId("ui-mode-indicator");
      // (a) same DOM node — no remount across the flip.
      expect(indicatorAfter).toBe(indicatorBefore);
      // (b) transform updated to the advanced segment's x-offset.
      expect(indicatorAfter.style.transform).toBe("translate(40px, 0px)");
      // (c) the user-driven flip did NOT set `transition: 'none'`. An
      // empty / unset string is the "use the CSS-cascaded transition"
      // path — that's what makes the indicator slide rather than snap.
      expect(indicatorAfter.style.transition).toBe("");
      // (d) data-active-id reflects the new value (sanity).
      expect(indicatorAfter).toHaveAttribute("data-active-id", "advanced");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetRect;
    }
  });
});
