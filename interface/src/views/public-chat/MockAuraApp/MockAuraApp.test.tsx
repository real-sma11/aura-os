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

import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
import { PERSONAS } from "../personas";

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

  /*
   * Persona avatar dock — one circular button per `PERSONAS` entry
   * inside the bottom-left mock dock pill. The dock is the second
   * entry point for persona swaps (next to `PersonaTickRail`), so
   * these tests pin both the visual contract (right number of
   * buttons, right active marker, right image-vs-fallback split)
   * and the wiring contract (clicks fire `onPersonaSelect` with the
   * array index of the clicked persona).
   */
  describe("persona avatar dock", () => {
    it("renders one button per entry in PERSONAS in array order", () => {
      render(<MockAuraApp />);
      const buttons = PERSONAS.map((persona) =>
        screen.getByTestId(`mock-aura-avatar-${persona.id}`),
      );
      expect(buttons).toHaveLength(PERSONAS.length);
      for (const [index, persona] of PERSONAS.entries()) {
        expect(buttons[index]).toHaveAttribute("data-persona-id", persona.id);
        expect(buttons[index].tagName).toBe("BUTTON");
        // `bottomChrome` is `aria-hidden`, so the dock buttons stay
        // out of the keyboard focus order.
        expect(buttons[index]).toHaveAttribute("tabindex", "-1");
      }
    });

    it("marks the button at activePersonaIndex as active and leaves the rest inactive", () => {
      render(<MockAuraApp activePersonaIndex={3} />);
      for (const [index, persona] of PERSONAS.entries()) {
        const button = screen.getByTestId(`mock-aura-avatar-${persona.id}`);
        expect(button).toHaveAttribute(
          "data-active",
          index === 3 ? "true" : "false",
        );
      }
    });

    it("defaults activePersonaIndex to 0 (Vibecoder) when omitted", () => {
      render(<MockAuraApp />);
      expect(
        screen.getByTestId(`mock-aura-avatar-${PERSONAS[0].id}`),
      ).toHaveAttribute("data-active", "true");
      expect(
        screen.getByTestId(`mock-aura-avatar-${PERSONAS[1].id}`),
      ).toHaveAttribute("data-active", "false");
    });

    it("fires onPersonaSelect with the array index when an avatar is clicked", () => {
      const onPersonaSelect = vi.fn();
      render(<MockAuraApp onPersonaSelect={onPersonaSelect} />);

      // Pick the Solo Builder slot (index 1) — distinct from the
      // default active index (0) so the click registers a real
      // change and the assertion isn't a no-op.
      fireEvent.click(screen.getByTestId("mock-aura-avatar-solo-builder"));

      expect(onPersonaSelect).toHaveBeenCalledTimes(1);
      expect(onPersonaSelect).toHaveBeenCalledWith(1);
    });

    it("paints the persona's portrait via background-image for themed personas and shows an initial-letter fallback for NO_THEME personas", () => {
      render(<MockAuraApp />);

      // Themed personas with a desktopBackgroundUrl render the
      // portrait inline as a background-image; their inner content
      // stays empty (no fallback letter to obscure the image).
      const vibecoder = screen.getByTestId("mock-aura-avatar-vibecoder");
      expect(vibecoder.style.backgroundImage).toContain(
        "/personas/vibecoder/desktop.png",
      );
      expect(vibecoder.textContent).toBe("");

      // NO_THEME personas (Giga Brain, Researcher) leave the
      // background-image empty and render the persona's initial
      // inside `.personaAvatarFallback` so the dock still shows
      // one circle per persona.
      const gigaBrain = screen.getByTestId("mock-aura-avatar-giga-brain");
      expect(gigaBrain.style.backgroundImage).toBe("");
      expect(gigaBrain.textContent).toBe("G");

      const researcher = screen.getByTestId("mock-aura-avatar-researcher");
      expect(researcher.style.backgroundImage).toBe("");
      expect(researcher.textContent).toBe("R");
    });
  });
});
