import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import type { UseTerminalReturn } from "../../hooks/use-terminal";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { getXtermTheme, type ResolvedTheme } from "./getXtermTheme";
import styles from "./XTerminal.module.css";

function readResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

interface XTerminalProps {
  terminal: UseTerminalReturn;
  visible: boolean;
  focused: boolean;
}

// Large scrollback so users can page back through long-running output
// (build logs, agent runs, etc.) inside Sidekick. xterm only allocates
// per actually-written cell, so the worst-case memory cost (~100k rows ×
// ~200 cols) is rarely realized in practice.
const SCROLLBACK_LINES = 100_000;

export function XTerminal({ terminal: hook, visible, focused }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hookRef = useRef(hook);
  const fitFrameRef = useRef<number | null>(null);
  const pendingFitRef = useRef({ force: false, notifyResize: false });
  const [viewportReady, setViewportReady] = useState(false);

  useEffect(() => {
    hookRef.current = hook;
  }, [hook]);

  const scheduleFit = useCallback((options: { force?: boolean; notifyResize?: boolean } = {}) => {
    pendingFitRef.current = {
      force: pendingFitRef.current.force || Boolean(options.force),
      notifyResize: pendingFitRef.current.notifyResize || Boolean(options.notifyResize),
    };

    if (fitFrameRef.current !== null) return;

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;

      const pending = pendingFitRef.current;
      pendingFitRef.current = { force: false, notifyResize: false };

      const container = containerRef.current;
      const xterm = xtermRef.current;
      const fitAddon = fitRef.current;
      if (!container || !xterm || !fitAddon) return;
      if (!pending.force && container.offsetHeight <= 0) return;

      const proposed = pending.force ? undefined : fitAddon.proposeDimensions();
      if (
        !pending.force
        && (!proposed || (proposed.cols === xterm.cols && proposed.rows === xterm.rows))
      ) {
        return;
      }

      fitAddon.fit();
      if (pending.notifyResize) {
        hookRef.current.resize(xterm.cols, xterm.rows);
      }
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new Terminal({
      theme: getXtermTheme(readResolvedTheme()),
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: SCROLLBACK_LINES,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(container);
    viewportRef.current = container.querySelector(".xterm-viewport") as HTMLDivElement | null;
    setViewportReady(Boolean(viewportRef.current));

    xtermRef.current = xterm;
    fitRef.current = fitAddon;

    // Prefer the GPU-accelerated renderer so scrolling through a deep
    // scrollback stays smooth. Fall back to the canvas renderer if WebGL
    // fails to initialize or its context is lost (e.g. tab backgrounded).
    let rendererAddon: ITerminalAddon | null = null;
    const loadCanvasFallback = () => {
      try {
        const canvas = new CanvasAddon();
        xterm.loadAddon(canvas);
        rendererAddon = canvas;
      } catch {
        rendererAddon = null;
      }
    };
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        if (rendererAddon === webgl) rendererAddon = null;
        loadCanvasFallback();
      });
      xterm.loadAddon(webgl);
      rendererAddon = webgl;
    } catch {
      loadCanvasFallback();
    }

    scheduleFit({ force: true, notifyResize: true });

    const dataDisposable = xterm.onData((data) => {
      hook.write(data);
    });

    const outputUnsub = hook.onOutput((data) => {
      xterm.write(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit({ notifyResize: true });
    });
    resizeObserver.observe(container);

    return () => {
      dataDisposable.dispose();
      outputUnsub();
      resizeObserver.disconnect();
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      rendererAddon?.dispose();
      rendererAddon = null;
      xterm.dispose();
      viewportRef.current = null;
      xtermRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleFit]);

  // Live theme swap: xterm.js v6 supports re-assigning `terminal.options.theme`
  // and re-renders without remounting, so existing scrollback survives a
  // dark<->light flip. We observe `<html data-theme>` directly rather than
  // keying off ZUI's `useTheme().resolvedTheme` because React effects fire
  // bottom-up: this component's effect would otherwise run BEFORE the parent
  // ThemeProvider effect that flips the attribute, causing
  // getComputedStyle(...) inside getXtermTheme to read the previous palette
  // and the terminal background to lag the rest of the chrome by one toggle.
  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    const root = document.documentElement;
    const apply = () => {
      xterm.options.theme = getXtermTheme(readResolvedTheme());
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible && fitRef.current) {
      scheduleFit({ force: true });
    }
  }, [scheduleFit, visible]);

  useEffect(() => {
    if (focused && fitRef.current) {
      scheduleFit({ force: true });
    }
  }, [focused, scheduleFit]);

  return (
    <div
      className={styles.container}
      style={{ display: visible ? "block" : "none" }}
    >
      <div ref={containerRef} className={styles.surface} />
      {viewportReady && (
        <OverlayScrollbar scrollRef={viewportRef} trackClassName={styles.overlayTrack} />
      )}
    </div>
  );
}
