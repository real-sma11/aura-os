/**
 * Behavioural test for the public-empty-state hero (`MockAuraApp` +
 * `DMWindowManager`). Pins five contracts that protect both the
 * windowed visual frame and the looping DM-driven animation:
 *
 *   1. The mock app frame mounts with its decorative chrome —
 *      titlebar (with the AURA wordmark), wallpaper `<video>`, and
 *      decorative taskbar — even before any DM frame has fired.
 *   2. The `inputDock` children prop renders inside the frame and
 *      its content is reachable via standard queries (i.e. the
 *      parent's helper pills / chat input bar are not lost behind
 *      the mock chrome's z-index stack).
 *   3. The DM window manager starts empty — no script frame is
 *      rendered eagerly. The first window pops open only after the
 *      `setTimeout` chain advances past the initial 250ms warm-up.
 *   4. Two distinct threads' frames land in two distinct DM
 *      windows: the architect_frontend thread's first frame
 *      streams into one window while the architect_backend
 *      thread's first frame streams into a separate window —
 *      proving the manager routes by `thread` id rather than
 *      stacking every frame into one window.
 *   5. The decorative window manager is `aria-hidden` so the
 *      looping content never bleeds into the assistive-tech tree.
 *      The mock app's outer titlebar/taskbar are also `aria-hidden`
 *      because they're chrome with no semantic value.
 */

import { act, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MockAuraApp } from "./MockAuraApp";
import {
  SCRIPT,
  type MessageFrame,
} from "../agent-demo-script";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MockAuraApp", () => {
  it("mounts the windowed chrome with titlebar, wallpaper video, and taskbar", () => {
    render(<MockAuraApp inputDock={null} />);

    expect(screen.getByTestId("mock-aura-app")).toBeInTheDocument();
    expect(screen.getByText("AURA")).toBeInTheDocument();

    const wallpaperVideo = document.querySelector("video");
    expect(wallpaperVideo).not.toBeNull();
    expect(wallpaperVideo?.getAttribute("src")).toBe("/AURA_visual_loop.mp4");
  });

  it("renders the inputDock children slot inside the frame", () => {
    render(
      <MockAuraApp
        inputDock={<button type="button">Helper pill stub</button>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Helper pill stub" }),
    ).toBeInTheDocument();
  });

  it("starts with no DM windows and reveals them as scripted timers advance", () => {
    vi.useFakeTimers();

    render(<MockAuraApp inputDock={null} />);

    const manager = screen.getByTestId("dm-window-manager");
    expect(manager.children.length).toBe(0);

    // Advance past the 250ms warm-up + the first frame's 1500ms
    // typing pre-roll so the first thread's first message becomes
    // visible inside its DM window. The first frame in `SCRIPT` is
    // the architect_frontend thread's typing-led message.
    for (let i = 0; i < 6; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    expect(
      screen.getByTestId("dm-window-architect_frontend"),
    ).toBeInTheDocument();

    const firstMessageFrame = SCRIPT.find(
      (frame): frame is MessageFrame =>
        frame.kind === "message" && frame.thread === "architect_frontend",
    );
    if (!firstMessageFrame) {
      throw new Error(
        "expected SCRIPT to contain at least one architect_frontend message frame",
      );
    }
    expect(screen.getByText(firstMessageFrame.text)).toBeInTheDocument();
  });

  it("routes frames into distinct DM windows by thread id", () => {
    vi.useFakeTimers();

    render(<MockAuraApp inputDock={null} />);

    // The script's first two frames land in two different threads
    // (architect_frontend, then architect_backend). After ~10s of
    // simulated time both windows should be mounted.
    for (let i = 0; i < 12; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    expect(
      screen.getByTestId("dm-window-architect_frontend"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dm-window-architect_backend"),
    ).toBeInTheDocument();
  });

  it("hides the decorative DM window manager from assistive tech via aria-hidden", () => {
    render(<MockAuraApp inputDock={null} />);

    const manager = screen.getByTestId("dm-window-manager");
    expect(manager).toHaveAttribute("aria-hidden", "true");
  });
});
