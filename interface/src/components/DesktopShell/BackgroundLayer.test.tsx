import { act, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTheme } from "@cypher-asi/zui";

const useThemeMock = vi.fn<() => { resolvedTheme: ResolvedTheme }>();
vi.mock("@cypher-asi/zui", () => ({
  useTheme: () => useThemeMock(),
}));

vi.mock("./DesktopShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

type BackgroundConfig = {
  mode: "color" | "image" | "none";
  color: string;
  imageDataUrl: string;
};
interface FakeState {
  light: BackgroundConfig;
  dark: BackgroundConfig;
  hydrated: boolean;
}

const fakeStore = vi.hoisted(() => {
  const NONE = { mode: "none" as const, color: "", imageDataUrl: "" };
  return {
    state: {
      light: { ...NONE },
      dark: { ...NONE },
      hydrated: true,
    } as FakeState,
    listeners: new Set<() => void>(),
  };
});

vi.mock("../../stores/desktop-background-store", async () => {
  const { useSyncExternalStore: useSES } = await import("react");
  function subscribe(listener: () => void) {
    fakeStore.listeners.add(listener);
    return () => fakeStore.listeners.delete(listener);
  }
  function useDesktopBackgroundStore<T>(selector: (s: FakeState) => T): T {
    return useSES(
      subscribe,
      () => selector(fakeStore.state),
      () => selector(fakeStore.state),
    );
  }
  useDesktopBackgroundStore.getState = () => fakeStore.state;
  return { useDesktopBackgroundStore };
});

function setFakeState(next: Partial<FakeState>) {
  fakeStore.state = { ...fakeStore.state, ...next };
  fakeStore.listeners.forEach((l) => l());
}

function resetFakeState() {
  const NONE: BackgroundConfig = { mode: "none", color: "", imageDataUrl: "" };
  fakeStore.state = { light: { ...NONE }, dark: { ...NONE }, hydrated: true };
  fakeStore.listeners.clear();
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  // JSDOM lacks `Image.decode`. Resolve immediately so the crossfade
  // pipeline can advance synchronously inside `act()`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window.Image.prototype as any).decode = function decode(): Promise<void> {
    return Promise.resolve();
  };
  useThemeMock.mockReset();
  useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
  resetFakeState();
  setReducedMotion(false);
  void useSyncExternalStore;
});

afterEach(() => {
  vi.useRealTimers();
});

async function flushFrames(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
  }
}

describe("BackgroundLayer", () => {
  it("renders nothing when the store is unhydrated", async () => {
    setFakeState({ hydrated: false });
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when both slots are mode=none", async () => {
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("paints the active color slot immediately on first render (no fade)", async () => {
    setFakeState({ dark: { mode: "color", color: "#abcdef", imageDataUrl: "" } });
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    await flushFrames();
    const layers = container.querySelectorAll("[data-role]");
    expect(layers).toHaveLength(1);
    const current = container.querySelector(
      '[data-role="current"]',
    ) as HTMLElement;
    expect(current).not.toBeNull();
    expect(current.style.backgroundColor).toBe("rgb(171, 205, 239)");
  });

  it("crossfades by stacking current + incoming when the active color changes", async () => {
    setFakeState({ dark: { mode: "color", color: "#111111", imageDataUrl: "" } });
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    await flushFrames();

    await act(async () => {
      setFakeState({
        dark: { mode: "color", color: "#222222", imageDataUrl: "" },
      });
    });
    await flushFrames();

    const current = container.querySelector(
      '[data-role="current"]',
    ) as HTMLElement;
    const incoming = container.querySelector(
      '[data-role="incoming"]',
    ) as HTMLElement;
    expect(current).not.toBeNull();
    expect(incoming).not.toBeNull();
    expect(current.getAttribute("data-bg-key")).toBe("color:#111111");
    expect(incoming.getAttribute("data-bg-key")).toBe("color:#222222");
    expect(incoming.className).toMatch(/bgFadeIncomingActive/);
  });

  it("promotes incoming to current on transitionend so only one layer remains", async () => {
    setFakeState({ dark: { mode: "color", color: "#111111", imageDataUrl: "" } });
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    await flushFrames();

    await act(async () => {
      setFakeState({
        dark: { mode: "color", color: "#222222", imageDataUrl: "" },
      });
    });
    await flushFrames();

    const incoming = container.querySelector(
      '[data-role="incoming"]',
    ) as HTMLElement;
    expect(incoming).not.toBeNull();

    await act(async () => {
      incoming.dispatchEvent(
        new TransitionEvent("transitionend", {
          propertyName: "opacity",
          bubbles: true,
        }),
      );
    });

    expect(container.querySelector('[data-role="incoming"]')).toBeNull();
    const current = container.querySelector(
      '[data-role="current"]',
    ) as HTMLElement;
    expect(current.getAttribute("data-bg-key")).toBe("color:#222222");
  });

  it("snaps without a fade when prefers-reduced-motion is set", async () => {
    setReducedMotion(true);
    setFakeState({ dark: { mode: "color", color: "#111111", imageDataUrl: "" } });
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    await flushFrames();

    await act(async () => {
      setFakeState({
        dark: { mode: "color", color: "#222222", imageDataUrl: "" },
      });
    });
    await flushFrames();

    expect(container.querySelector('[data-role="incoming"]')).toBeNull();
    const current = container.querySelector(
      '[data-role="current"]',
    ) as HTMLElement;
    expect(current.getAttribute("data-bg-key")).toBe("color:#222222");
  });

  it("waits for Image.decode before swapping in an image", async () => {
    let resolveDecode: (() => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.Image.prototype as any).decode = function decode(): Promise<void> {
      return new Promise<void>((resolve) => {
        resolveDecode = resolve;
      });
    };

    setFakeState({ dark: { mode: "color", color: "#111111", imageDataUrl: "" } });
    const { BackgroundLayer } = await import("./BackgroundLayer");
    const { container } = render(<BackgroundLayer />);
    await flushFrames();

    await act(async () => {
      setFakeState({
        dark: {
          mode: "image",
          color: "",
          imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
      });
    });
    await flushFrames();

    expect(container.querySelector('[data-role="incoming"]')).toBeNull();
    expect(typeof resolveDecode).toBe("function");

    await act(async () => {
      resolveDecode?.();
      await Promise.resolve();
    });
    await flushFrames();

    const incoming = container.querySelector(
      '[data-role="incoming"]',
    ) as HTMLElement;
    expect(incoming).not.toBeNull();
    expect(incoming.getAttribute("data-bg-key")).toMatch(/^image:/);
  });
});
