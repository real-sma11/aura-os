import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOP_RESIZE_BAND_LOGICAL_PX,
  __resetNativeTitlebarResizeForTests,
  installNativeTitlebarResize,
  shouldInstallNativeTitlebarResize,
  shouldShowTopResizeCursor,
  shouldStartTopResize,
} from "./native-titlebar-resize";

function firePointerEvent(
  type: "pointerdown" | "pointermove",
  target: Element,
  init: PointerEventInit & { clientY?: number } = {},
) {
  const PointerEventCtor =
    (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ??
    (class extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    } as unknown as typeof PointerEvent);
  const event = new PointerEventCtor(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function mountTopBandTarget(innerHtml: string): HTMLElement {
  document.body.innerHTML = `<div data-testid="bar" style="position:fixed;top:0;left:0;width:100%;height:32px;">${innerHtml}</div>`;
  return document.querySelector<HTMLElement>('[data-testid="bar"]')!;
}

describe("shouldInstallNativeTitlebarResize", () => {
  it("skips without a desktop bridge", () => {
    expect(shouldInstallNativeTitlebarResize(false)).toBe(false);
  });

  it("activates whenever a desktop bridge is present (all platforms)", () => {
    // The wry/WebView2/WKWebView/WebKitGTK capture problem applies on
    // every supported desktop platform, so unlike the drag bridge
    // there's no Windows opt-out.
    expect(shouldInstallNativeTitlebarResize(true)).toBe(true);
  });
});

describe("shouldShowTopResizeCursor", () => {
  it("is true at the very top edge", () => {
    expect(shouldShowTopResizeCursor({ clientY: 0 })).toBe(true);
  });

  it("is true at the last pixel of the band", () => {
    expect(
      shouldShowTopResizeCursor({ clientY: TOP_RESIZE_BAND_LOGICAL_PX - 1 }),
    ).toBe(true);
  });

  it("is false at the first pixel below the band", () => {
    expect(
      shouldShowTopResizeCursor({ clientY: TOP_RESIZE_BAND_LOGICAL_PX }),
    ).toBe(false);
  });

  it("is false for negative coords (cursor above the window)", () => {
    expect(shouldShowTopResizeCursor({ clientY: -1 })).toBe(false);
  });
});

describe("shouldStartTopResize", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns true for a primary-button pointerdown inside the band on a non-interactive target", () => {
    const bar = mountTopBandTarget("<span id='label'>AURA</span>");
    const event = firePointerEvent(
      "pointerdown",
      document.getElementById("label")!,
      { clientY: 5 },
    );
    expect(shouldStartTopResize(event)).toBe(true);
    expect(bar).toBeDefined();
  });

  it("returns false on a button inside the band (so button clicks still work)", () => {
    mountTopBandTarget('<button id="btn">x</button>');
    const event = firePointerEvent(
      "pointerdown",
      document.getElementById("btn")!,
      { clientY: 8 },
    );
    expect(shouldStartTopResize(event)).toBe(false);
  });

  it("returns false on a target inside .titlebar-no-drag in the band", () => {
    mountTopBandTarget(
      '<div class="titlebar-no-drag"><span id="ctrl">x</span></div>',
    );
    const event = firePointerEvent(
      "pointerdown",
      document.getElementById("ctrl")!,
      { clientY: 8 },
    );
    expect(shouldStartTopResize(event)).toBe(false);
  });

  it("returns false below the band, even on a non-interactive target", () => {
    mountTopBandTarget("<span id='label'>AURA</span>");
    const event = firePointerEvent(
      "pointerdown",
      document.getElementById("label")!,
      { clientY: TOP_RESIZE_BAND_LOGICAL_PX + 5 },
    );
    expect(shouldStartTopResize(event)).toBe(false);
  });

  it("returns false for non-primary mouse buttons", () => {
    mountTopBandTarget("<span id='label'>AURA</span>");
    const event = firePointerEvent(
      "pointerdown",
      document.getElementById("label")!,
      { clientY: 5, button: 2 },
    );
    expect(shouldStartTopResize(event)).toBe(false);
  });
});

describe("installNativeTitlebarResize", () => {
  const originalIpc = window.ipc;

  beforeEach(() => {
    __resetNativeTitlebarResizeForTests();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.ipc = originalIpc;
    __resetNativeTitlebarResizeForTests();
    document.body.innerHTML = "";
  });

  it("sends resize-n IPC on pointerdown inside the band", () => {
    const postMessage = vi.fn();
    window.ipc = { postMessage };
    installNativeTitlebarResize();
    mountTopBandTarget("<span id='label'>AURA</span>");

    firePointerEvent("pointerdown", document.getElementById("label")!, {
      clientY: 5,
    });

    expect(postMessage).toHaveBeenCalledWith("resize-n");
  });

  it("does not send IPC when the pointerdown target is interactive", () => {
    const postMessage = vi.fn();
    window.ipc = { postMessage };
    installNativeTitlebarResize();
    mountTopBandTarget('<button id="btn">x</button>');

    firePointerEvent("pointerdown", document.getElementById("btn")!, {
      clientY: 5,
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("does not send IPC for pointerdowns below the band", () => {
    const postMessage = vi.fn();
    window.ipc = { postMessage };
    installNativeTitlebarResize();
    mountTopBandTarget("<span id='label'>AURA</span>");

    firePointerEvent("pointerdown", document.getElementById("label")!, {
      clientY: TOP_RESIZE_BAND_LOGICAL_PX + 1,
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("paints the body cursor to n-resize on pointermove inside the band", () => {
    window.ipc = { postMessage: vi.fn() };
    installNativeTitlebarResize();
    mountTopBandTarget("<span id='label'>AURA</span>");

    firePointerEvent("pointermove", document.getElementById("label")!, {
      clientY: 5,
    });

    expect(document.body.style.cursor).toBe("n-resize");
  });

  it("clears the body cursor when the pointer moves out of the band", () => {
    window.ipc = { postMessage: vi.fn() };
    installNativeTitlebarResize();
    mountTopBandTarget("<span id='label'>AURA</span>");

    firePointerEvent("pointermove", document.getElementById("label")!, {
      clientY: 5,
    });
    expect(document.body.style.cursor).toBe("n-resize");

    firePointerEvent("pointermove", document.getElementById("label")!, {
      clientY: TOP_RESIZE_BAND_LOGICAL_PX + 5,
    });
    expect(document.body.style.cursor).toBe("");
  });

  it("does not preventDefault, so dblclick on the titlebar still fires", () => {
    window.ipc = { postMessage: vi.fn() };
    installNativeTitlebarResize();
    mountTopBandTarget("<span id='label'>AURA</span>");

    const event = firePointerEvent(
      "pointerdown",
      document.getElementById("label")!,
      { clientY: 5 },
    );

    expect(event.defaultPrevented).toBe(false);
  });

  it("is a no-op without a desktop bridge", () => {
    delete (window as Window & { ipc?: unknown }).ipc;
    installNativeTitlebarResize();
    mountTopBandTarget("<span id='label'>AURA</span>");

    // No throw is the assertion here — without a bridge no listener
    // should be installed at all, so a pointerdown that would
    // otherwise call `windowCommand` must not crash.
    firePointerEvent("pointerdown", document.getElementById("label")!, {
      clientY: 5,
    });
  });
});
