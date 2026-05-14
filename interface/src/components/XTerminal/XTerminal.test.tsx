import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

// xterm.js renders to a real canvas/webgl context that JSDOM doesn't
// implement. Replace it (and its addons) with inert stubs so we can mount
// XTerminal and assert against the live `options.theme` swap that the
// component performs in response to `<html data-theme>` flips.
type CustomKeyHandler = (event: KeyboardEvent) => boolean;

const testState = vi.hoisted(() => ({
  capturedTerminals: [] as Array<{
    options: { theme: unknown };
    cols: number;
    rows: number;
    clear: ReturnType<typeof vi.fn>;
    customKeyHandler: ((event: KeyboardEvent) => boolean) | null;
  }>,
  capturedFitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }>,
  proposedDimensions: { cols: 80, rows: 24 } as { cols: number; rows: number } | undefined,
  resizeObserverCallback: null as ResizeObserverCallback | null,
  rafCallbacks: [] as FrameRequestCallback[],
}));

vi.mock("@xterm/xterm", () => {
  class StubTerminal {
    options: { theme: unknown };
    cols = 80;
    rows = 24;
    clear = vi.fn();
    customKeyHandler: CustomKeyHandler | null = null;
    constructor(opts: { theme: unknown }) {
      this.options = { theme: opts.theme };
      testState.capturedTerminals.push(this);
    }
    loadAddon(addon: { activate?: (terminal: StubTerminal) => void }): void {
      addon.activate?.(this);
    }
    open(container?: HTMLElement): void {
      const viewport = document.createElement("div");
      viewport.className = "xterm-viewport";
      container?.appendChild(viewport);
    }
    onData(): { dispose: () => void } {
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler(handler: CustomKeyHandler): void {
      this.customKeyHandler = handler;
    }
    write(): void {}
    dispose(): void {}
  }
  return { Terminal: StubTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class StubFitAddon {
    private terminal: { cols: number; rows: number } | null = null;
    fit = vi.fn(() => {
      if (!this.terminal || !testState.proposedDimensions) return;
      this.terminal.cols = testState.proposedDimensions.cols;
      this.terminal.rows = testState.proposedDimensions.rows;
    });
    proposeDimensions = vi.fn(() => testState.proposedDimensions);
    constructor() {
      testState.capturedFitAddons.push(this);
    }
    activate(terminal: { cols: number; rows: number }): void {
      this.terminal = terminal;
    }
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss(): void {}
    dispose(): void {}
  },
}));
vi.mock("@xterm/addon-canvas", () => ({ CanvasAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../OverlayScrollbar", () => ({ OverlayScrollbar: () => null }));

const VAR_NAMES = [
  "--color-terminal-bg",
  "--color-terminal-fg",
  "--color-terminal-cursor",
];

function setVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function clearVars() {
  for (const name of VAR_NAMES) {
    document.documentElement.style.removeProperty(name);
  }
}

function makeHook() {
  return {
    terminalId: "t1",
    connected: true,
    write: vi.fn(),
    resize: vi.fn(),
    onOutput: vi.fn(() => () => {}),
    kill: vi.fn(),
  };
}

// MutationObserver delivers callbacks on a microtask queue; flush it.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushAnimationFrames() {
  const callbacks = testState.rafCallbacks.splice(0);
  for (const callback of callbacks) {
    callback(performance.now());
  }
  await Promise.resolve();
}

beforeEach(() => {
  testState.capturedTerminals.length = 0;
  testState.capturedFitAddons.length = 0;
  testState.proposedDimensions = { cols: 80, rows: 24 };
  testState.resizeObserverCallback = null;
  testState.rafCallbacks.length = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      testState.rafCallbacks.push(callback);
      return testState.rafCallbacks.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class StubResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        testState.resizeObserverCallback = callback;
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 100,
  });
  document.documentElement.setAttribute("data-theme", "dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearVars();
  document.documentElement.removeAttribute("data-theme");
});

describe("XTerminal theme syncing", () => {
  it("reapplies xterm theme when <html data-theme> flips", async () => {
    setVar("--color-terminal-bg", "#111111");
    const { XTerminal } = await import("./XTerminal");

    const hook = makeHook();

    render(<XTerminal terminal={hook} visible focused />);

    const term = testState.capturedTerminals.at(-1);
    expect(term).toBeDefined();
    // Initial mount: dark token reads through to xterm.
    expect((term!.options.theme as { background: string }).background).toBe("#111111");

    // Flip the global theme attribute. The component's MutationObserver
    // should rerun getXtermTheme and reassign options.theme with the new
    // CSS-variable value — this is the regression guard for the bug where
    // the terminal background lagged the rest of the UI by one toggle
    // because XTerminal's resolvedTheme effect ran before ZUI's
    // ThemeProvider effect that flips data-theme.
    setVar("--color-terminal-bg", "#fafafa");
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "light");
      await flushMicrotasks();
    });

    expect((term!.options.theme as { background: string }).background).toBe("#fafafa");
  });
});

describe("XTerminal Ctrl+L handling", () => {
  it("clears the xterm buffer (and scrollback) when Ctrl+L is pressed", async () => {
    const { XTerminal } = await import("./XTerminal");
    const hook = makeHook();
    render(<XTerminal terminal={hook} visible focused />);

    const term = testState.capturedTerminals.at(-1);
    expect(term).toBeDefined();
    expect(term!.customKeyHandler).toBeDefined();

    const event = new KeyboardEvent("keydown", { key: "l", ctrlKey: true });
    const passthrough = term!.customKeyHandler!(event);

    expect(term!.clear).toHaveBeenCalledTimes(1);
    // Returning true lets xterm.js forward the keystroke to the PTY so
    // the shell also redraws its prompt (mirrors native ^L behavior).
    expect(passthrough).toBe(true);
  });

  it("does not clear when Ctrl+L is pressed with another modifier", async () => {
    const { XTerminal } = await import("./XTerminal");
    const hook = makeHook();
    render(<XTerminal terminal={hook} visible focused />);

    const term = testState.capturedTerminals.at(-1);
    expect(term).toBeDefined();

    term!.customKeyHandler!(
      new KeyboardEvent("keydown", { key: "l", ctrlKey: true, shiftKey: true }),
    );
    term!.customKeyHandler!(
      new KeyboardEvent("keydown", { key: "l", ctrlKey: true, altKey: true }),
    );
    // Plain `l` keystroke (no modifier) must also be ignored.
    term!.customKeyHandler!(new KeyboardEvent("keydown", { key: "l" }));
    // keyup events for Ctrl+L must not trigger a second clear.
    term!.customKeyHandler!(new KeyboardEvent("keyup", { key: "l", ctrlKey: true }));

    expect(term!.clear).not.toHaveBeenCalled();
  });
});

describe("XTerminal resize fitting", () => {
  it("skips resize observer fits when proposed dimensions are unchanged", async () => {
    const { XTerminal } = await import("./XTerminal");
    const hook = makeHook();

    render(<XTerminal terminal={hook} visible focused />);
    await act(async () => {
      await flushAnimationFrames();
    });

    const fitAddon = testState.capturedFitAddons.at(-1);
    expect(fitAddon).toBeDefined();
    expect(fitAddon!.fit).toHaveBeenCalledTimes(1);
    expect(hook.resize).toHaveBeenCalledTimes(1);

    testState.resizeObserverCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    await act(async () => {
      await flushAnimationFrames();
    });

    expect(fitAddon!.proposeDimensions).toHaveBeenCalledTimes(1);
    expect(fitAddon!.fit).toHaveBeenCalledTimes(1);
    expect(hook.resize).toHaveBeenCalledTimes(1);
  });

  it("fits and notifies the terminal hook when proposed dimensions change", async () => {
    const { XTerminal } = await import("./XTerminal");
    const hook = makeHook();

    render(<XTerminal terminal={hook} visible focused />);
    await act(async () => {
      await flushAnimationFrames();
    });

    const fitAddon = testState.capturedFitAddons.at(-1);
    expect(fitAddon).toBeDefined();

    testState.proposedDimensions = { cols: 100, rows: 30 };
    testState.resizeObserverCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    await act(async () => {
      await flushAnimationFrames();
    });

    expect(fitAddon!.fit).toHaveBeenCalledTimes(2);
    expect(hook.resize).toHaveBeenCalledTimes(2);
    expect(hook.resize).toHaveBeenLastCalledWith(100, 30);
  });
});
