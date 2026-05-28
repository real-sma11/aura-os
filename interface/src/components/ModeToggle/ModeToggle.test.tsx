import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModeToggle } from "./ModeToggle";
import { useUIModeStore } from "../../stores/ui-mode-store";
import { useAuthStore } from "../../stores/auth-store";
import {
  LAST_ADVANCED_PATH_KEY,
  LAST_SIMPLE_PATH_KEY,
} from "../../constants";

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

/**
 * Probe component that records the current `pathname + search` into
 * a `data-testid="probe"` element so tests can assert that
 * `ModeToggle.handleChange` navigated to the expected URL.
 */
function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return (
    <div data-testid="probe-location">
      {`${location.pathname}${location.search}`}
    </div>
  );
}

function renderToggle(initialPath: string = "/chat"): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ModeToggle />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ModeToggle", () => {
  it("renders both segments labelled Simple and Advanced", () => {
    renderToggle();
    // Built on `SlidingPills`, so segments expose `role="radio"`
    // (matches the chat input ModeSelector for a consistent feel).
    expect(screen.getByRole("radio", { name: "Simple" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Advanced" })).toBeInTheDocument();
  });

  it("reflects the store's active mode via aria-checked", () => {
    useUIModeStore.setState({ mode: "simple" });
    renderToggle();
    expect(
      screen.getByRole("radio", { name: "Simple", checked: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Advanced", checked: false }),
    ).toBeInTheDocument();
  });

  it("flips the store when a segment is clicked", async () => {
    const user = userEvent.setup();
    renderToggle();

    expect(useUIModeStore.getState().mode).toBe("advanced");
    await user.click(screen.getByRole("radio", { name: "Simple" }));
    expect(useUIModeStore.getState().mode).toBe("simple");
    await user.click(screen.getByRole("radio", { name: "Advanced" }));
    expect(useUIModeStore.getState().mode).toBe("advanced");
  });

  it("exposes a single sliding indicator that tracks the active segment", () => {
    useUIModeStore.setState({ mode: "advanced" });
    const { container } = renderToggle();
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
    const { container } = renderToggle();
    const indicator = container.querySelector(
      "[data-sliding-pills-indicator]",
    );
    expect(indicator).toHaveAttribute("data-active-id", "simple");
  });

  it("does not render in public (logged-out) effective mode", () => {
    // `useEffectiveMode()` returns `"public"` whenever the user is
    // logged out, regardless of the persisted `mode`. AuraSidebar
    // already gates the render at the parent level with
    // `mode !== "public" && <ModeToggle />`; the component itself
    // returns null in public as defense-in-depth so direct mounts
    // (tests, future surfaces) get the same answer. The radiogroup
    // and the wrapper div should both be absent from the DOM.
    useAuthStore.setState({ user: null });
    const { container } = renderToggle();
    expect(
      screen.queryByRole("radiogroup", { name: "Interface mode" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-agent-surface='ui-mode-toggle']"),
    ).toBeNull();
  });

  describe("per-mode last-path restore", () => {
    it("flipping Advanced -> Simple navigates to the stored last simple path", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(
        LAST_SIMPLE_PATH_KEY,
        "/chat?session=abc",
      );
      useUIModeStore.setState({ mode: "advanced" });
      renderToggle("/notes/note-1");

      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/notes/note-1",
      );
      await user.click(screen.getByRole("radio", { name: "Simple" }));
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/chat?session=abc",
      );
    });

    it("flipping Simple -> Advanced navigates to the stored last advanced path", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(LAST_ADVANCED_PATH_KEY, "/notes/note-2");
      useUIModeStore.setState({ mode: "simple" });
      renderToggle("/chat?session=abc");

      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/chat?session=abc",
      );
      await user.click(screen.getByRole("radio", { name: "Advanced" }));
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/notes/note-2",
      );
    });

    it("does NOT navigate when the destination bucket is empty (Simple fallback)", async () => {
      const user = userEvent.setup();
      // No LAST_SIMPLE_PATH_KEY persisted — the toggle should leave
      // the URL untouched (ChatRedirectGuard, mounted in the real
      // route tree, is what pulls the user to `/chat` in production).
      useUIModeStore.setState({ mode: "advanced" });
      renderToggle("/notes/note-1");

      await user.click(screen.getByRole("radio", { name: "Simple" }));
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/notes/note-1",
      );
    });

    it("does NOT navigate when the destination bucket is empty (Advanced fallback)", async () => {
      const user = userEvent.setup();
      useUIModeStore.setState({ mode: "simple" });
      renderToggle("/chat?session=abc");

      await user.click(screen.getByRole("radio", { name: "Advanced" }));
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/chat?session=abc",
      );
    });

    it("re-clicking the active segment is a navigation no-op", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(LAST_ADVANCED_PATH_KEY, "/notes/other");
      useUIModeStore.setState({ mode: "advanced" });
      renderToggle("/notes/note-1");

      await user.click(screen.getByRole("radio", { name: "Advanced" }));
      // No flip happened, so the stored advanced path should NOT
      // override the current URL.
      expect(screen.getByTestId("probe-location")).toHaveTextContent(
        "/notes/note-1",
      );
    });
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
      const wrapped = (
        <MemoryRouter>
          <ModeToggle />
        </MemoryRouter>
      );
      const { rerender } = render(wrapped);
      const indicatorBefore = screen.getByTestId("ui-mode-indicator");
      const transformBefore = indicatorBefore.style.transform;
      // Initial mount uses the snap path (`transition: 'none'`); we
      // capture the transform but do NOT assert against `transition`
      // here — the slide assertion runs against the post-flip apply.
      expect(transformBefore).toBe("translate(0px, 0px)");

      await act(async () => {
        useUIModeStore.setState({ mode: "advanced" });
      });
      rerender(
        <MemoryRouter>
          <ModeToggle />
        </MemoryRouter>,
      );

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
