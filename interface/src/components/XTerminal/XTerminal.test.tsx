import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

// xterm.js renders to a real canvas/webgl context that JSDOM doesn't
// implement. Replace it (and its addons) with inert stubs so we can mount
// XTerminal and assert against the live `options.theme` swap that the
// component performs in response to `<html data-theme>` flips.
const { capturedTerminals } = vi.hoisted(() => ({
  capturedTerminals: [] as Array<{ options: { theme: unknown } }>,
}));

vi.mock("@xterm/xterm", () => {
  class StubTerminal {
    options: { theme: unknown };
    cols = 80;
    rows = 24;
    constructor(opts: { theme: unknown }) {
      this.options = { theme: opts.theme };
      capturedTerminals.push(this);
    }
    loadAddon(): void {}
    open(): void {}
    onData(): { dispose: () => void } {
      return { dispose: () => {} };
    }
    write(): void {}
    dispose(): void {}
  }
  return { Terminal: StubTerminal };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {}
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

// MutationObserver delivers callbacks on a microtask queue; flush it.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  capturedTerminals.length = 0;
  document.documentElement.setAttribute("data-theme", "dark");
});

afterEach(() => {
  clearVars();
  document.documentElement.removeAttribute("data-theme");
});

describe("XTerminal theme syncing", () => {
  it("reapplies xterm theme when <html data-theme> flips", async () => {
    setVar("--color-terminal-bg", "#111111");
    const { XTerminal } = await import("./XTerminal");

    const hook = {
      terminalId: "t1",
      connected: true,
      write: vi.fn(),
      resize: vi.fn(),
      onOutput: vi.fn(() => () => {}),
      kill: vi.fn(),
    };

    render(<XTerminal terminal={hook} visible focused />);

    const term = capturedTerminals.at(-1);
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
