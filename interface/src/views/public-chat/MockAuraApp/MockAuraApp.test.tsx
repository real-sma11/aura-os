/**
 * Behavioural test for the public-empty-state hero (`MockAuraApp` +
 * `DMWindowManager`). Pins the contracts that protect both the
 * windowed visual frame and the looping DM-driven animation:
 *
 *   1. The mock app frame mounts with its decorative chrome — the
 *      real `ShellTitlebar` pill (with the AURA wordmark `<img>`
 *      in its title slot) overlaid via `.topChrome` and the three
 *      bottom dock pills overlaid via `.bottomChrome` — even before
 *      any DM frame has fired. The top/bottom overlays are pinned
 *      via dedicated `data-testid` hooks so the assertion does not
 *      depend on internal class names.
 *   2. With no `desktopBackgroundUrl` supplied (the NO_THEME case)
 *      no wallpaper layer mounts at all — the frame's own dark
 *      fill paints through. Supplying a URL mounts an `<img>`
 *      wallpaper.
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
 *      The top/bottom chrome overlays are also `aria-hidden`
 *      because they're decorative with no semantic value.
 */

import { act, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MockAuraApp } from "./MockAuraApp";
import { deriveChatPalette } from "./derive-chat-palette";
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
  it("mounts the windowed chrome with titlebar pill and bottom dock pills, and no wallpaper layer in the NO_THEME case", () => {
    render(<MockAuraApp />);

    expect(screen.getByTestId("mock-aura-app")).toBeInTheDocument();

    // The AURA wordmark is now an <img alt="AURA"> rendered by
    // `ShellTitlebar`'s title slot rather than visible text.
    expect(screen.getByAltText("AURA")).toBeInTheDocument();

    const topChrome = screen.getByTestId("mock-aura-top-chrome");
    expect(topChrome).toBeInTheDocument();
    expect(topChrome).toHaveAttribute("aria-hidden", "true");

    const bottomChrome = screen.getByTestId("mock-aura-bottom-chrome");
    expect(bottomChrome).toBeInTheDocument();
    expect(bottomChrome).toHaveAttribute("aria-hidden", "true");

    // NO_THEME personas (and the unparameterised default) don't
    // mount a wallpaper layer at all — `.appFrame`'s own near-black
    // fill paints through. Pin both: no <video> and no wallpaper
    // <img>.
    expect(document.querySelector("video")).toBeNull();
    expect(
      screen.queryByTestId("mock-aura-wallpaper-image"),
    ).not.toBeInTheDocument();
  });

  it("mounts an <img> wallpaper layer when a desktopBackgroundUrl is provided", () => {
    render(
      <MockAuraApp desktopBackgroundUrl="/personas/solo-builder/desktop.png" />,
    );

    const wallpaperImage = screen.getByTestId("mock-aura-wallpaper-image");
    expect(wallpaperImage).toBeInTheDocument();
    expect(wallpaperImage).toHaveAttribute(
      "src",
      "/personas/solo-builder/desktop.png",
    );
    expect(document.querySelector("video")).toBeNull();
  });

  it("starts with no DM windows and reveals them as scripted timers advance", () => {
    vi.useFakeTimers();

    render(<MockAuraApp />);

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

    render(<MockAuraApp />);

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

  it("renders a single participant name in each DM window titlebar", () => {
    vi.useFakeTimers();

    render(<MockAuraApp />);

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    const titlebar = screen.getByTestId("dm-window-architect_frontend-titlebar");
    expect(within(titlebar).getByText("Frontend")).toBeInTheDocument();
    expect(within(titlebar).queryByText("Architect")).not.toBeInTheDocument();
  });

  it("hides the decorative DM window manager from assistive tech via aria-hidden", () => {
    render(<MockAuraApp />);

    const manager = screen.getByTestId("dm-window-manager");
    expect(manager).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves the frame un-themed (no data attribute, no inline mock vars) when no chatPalette is supplied", () => {
    render(<MockAuraApp />);
    const frame = screen.getByTestId("mock-aura-app");
    // NO_THEME personas (and the default landing surface) reach
    // here with `chatPalette = null` — the persona override block
    // in MockAuraApp.module.css is keyed on this attribute and
    // must NOT fire so the existing shell tokens keep painting.
    expect(frame).not.toHaveAttribute("data-persona-themed");
    expect(frame.style.getPropertyValue("--mock-text")).toBe("");
  });

  it("applies data-persona-themed and the --mock-* custom properties when a chatPalette is supplied", () => {
    const palette = deriveChatPalette("#b3c4d2", "dark");
    if (!palette) {
      throw new Error("expected deriveChatPalette to return a palette");
    }
    render(<MockAuraApp chatPalette={palette} />);
    const frame = screen.getByTestId("mock-aura-app");
    expect(frame).toHaveAttribute("data-persona-themed", "true");
    expect(frame.style.getPropertyValue("--mock-text")).toBe(palette.text);
    expect(frame.style.getPropertyValue("--mock-text-secondary")).toBe(
      palette.textSecondary,
    );
    expect(frame.style.getPropertyValue("--mock-text-muted")).toBe(
      palette.textMuted,
    );
    expect(frame.style.getPropertyValue("--mock-hljs-keyword")).toBe(
      palette.hljsKeyword,
    );
    expect(frame.style.getPropertyValue("--mock-hljs-string")).toBe(
      palette.hljsString,
    );
    expect(frame.style.getPropertyValue("--mock-hljs-comment")).toBe(
      palette.hljsComment,
    );
  });
});
