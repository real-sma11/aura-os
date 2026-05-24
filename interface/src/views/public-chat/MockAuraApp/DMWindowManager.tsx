import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  SCRIPT,
  THREADS,
  type DemoFrame,
  type ThreadId,
} from "../agent-demo-script";
import {
  DMWindow,
  WINDOW_CLOSE_MS,
  type DMWindowFrame,
} from "./DMWindow";
import styles from "./DMWindowManager.module.css";

/**
 * Stagger between successive window closes, in ms. Together with
 * `WINDOW_CLOSE_MS` this drives the cascade tear-down at the end of
 * the script loop: windows are sorted in descending z-order and
 * each one's `animation-delay` is `index * WINDOW_CLOSE_STAGGER_MS`,
 * so the most-recently focused window collapses first and the
 * cascade unwinds in reverse focus order. The total close phase
 * lasts `WINDOW_CLOSE_MS + (windowCount - 1) * STAGGER`.
 */
const WINDOW_CLOSE_STAGGER_MS = 120;

/**
 * Wall-clock the script holds at its final frame before triggering
 * the close animation. Preserves the prior "2400ms dwell at the
 * end of the loop" behaviour so visitors who linger see the final
 * Reviewer / Architect exchange resolved before the cascade tears
 * down and the loop restarts.
 */
const END_DWELL_MS = 2400;

/**
 * Walks `SCRIPT` on a `setTimeout` chain, the same way the previous
 * `AgentDemoBanner` reducer did, and routes each frame into the DM
 * window matching `frame.thread`. A thread's window mounts the
 * first time it receives a frame, animates a brief pop-open, and
 * persists for the rest of the loop (further frames just append
 * messages inside the same window). When the script reaches its
 * end the manager resets after a 2400ms dwell — every window
 * unmounts and the loop restarts from frame 0.
 *
 * The whole subtree is `aria-hidden`: it's atmosphere, not content.
 *
 * Window positions are deterministic per thread (see
 * `THREAD_POSITIONS` below) so the layout always reads the same on
 * page load. Each window's z-index is bumped to the top of the
 * stack the moment it last received a frame, mirroring how
 * MSN/ICQ-era IM clients raise the focused window.
 */

interface KeyedFrame {
  readonly key: number;
  readonly frame: DemoFrame;
}

interface ThreadWindowState {
  readonly threadId: ThreadId;
  readonly frames: ReadonlyArray<KeyedFrame>;
  /**
   * Monotonic ordering counter the renderer uses to compute z-index
   * — the highest `lastTouchedAt` paints on top, simulating window
   * focus when a thread receives a new frame.
   */
  readonly lastTouchedAt: number;
}

/**
 * Lifecycle phases for the manager.
 *
 *   - `running`: the script is mid-loop. `advance` ticks add frames
 *     to existing windows or mount new ones.
 *   - `closing`: the script reached its final frame, `END_DWELL_MS`
 *     of dwell has elapsed, and every window is now playing its
 *     `dmWindowCollapse` animation. New `advance` actions are
 *     ignored. After the longest close (`WINDOW_CLOSE_MS +
 *     (windows.length - 1) * STAGGER`) the manager dispatches
 *     `reset`, the loop restarts, and the phase flips back to
 *     `running`.
 */
type ManagerPhase = "running" | "closing";

type ManagerState = {
  readonly windows: ReadonlyArray<ThreadWindowState>;
  readonly cursor: number;
  readonly nextKey: number;
  readonly tick: number;
  readonly phase: ManagerPhase;
};

type ManagerAction =
  | { type: "advance" }
  | { type: "focus"; threadId: ThreadId }
  | { type: "beginClose" }
  | { type: "reset" };

const INITIAL_STATE: ManagerState = {
  windows: [],
  cursor: 0,
  nextKey: 0,
  tick: 0,
  phase: "running",
};

function managerReducer(
  state: ManagerState,
  action: ManagerAction,
): ManagerState {
  switch (action.type) {
    case "advance": {
      // Ignore advances after the script ended or while the close
      // animation is in flight — the dwell + close timers in the
      // effect below own the lifecycle from `closing` onward and
      // anything that fired in flight (e.g. a stale `setTimeout`
      // racing with the unmount) would otherwise mutate the
      // collapsing cascade.
      if (state.cursor >= SCRIPT.length || state.phase !== "running") {
        return state;
      }
      const frame = SCRIPT[state.cursor];
      const tick = state.tick + 1;
      const keyed: KeyedFrame = { key: state.nextKey, frame };

      const existingIdx = state.windows.findIndex(
        (w) => w.threadId === frame.thread,
      );

      const nextWindows: ThreadWindowState[] =
        existingIdx === -1
          ? [
              ...state.windows,
              {
                threadId: frame.thread,
                frames: [keyed],
                lastTouchedAt: tick,
              },
            ]
          : state.windows.map((w, i) =>
              i === existingIdx
                ? {
                    ...w,
                    frames: [...w.frames, keyed],
                    lastTouchedAt: tick,
                  }
                : w,
            );

      return {
        ...state,
        windows: nextWindows,
        cursor: state.cursor + 1,
        nextKey: state.nextKey + 1,
        tick,
      };
    }
    case "focus": {
      // User clicked a DM window — raise it above its peers by
      // bumping `lastTouchedAt`, which feeds `zByThread` /
      // `focusedThreadId` below. Guarded so a stray click during
      // the reverse-z close cascade can't reshuffle which window
      // collapses first. Also a no-op when the target is unknown
      // (script hasn't opened it yet) or already on top, to avoid
      // pointless re-renders.
      if (state.phase !== "running") return state;
      const idx = state.windows.findIndex(
        (w) => w.threadId === action.threadId,
      );
      if (idx === -1) return state;
      let maxTouched = state.windows[0].lastTouchedAt;
      for (const w of state.windows) {
        if (w.lastTouchedAt > maxTouched) maxTouched = w.lastTouchedAt;
      }
      if (state.windows[idx].lastTouchedAt === maxTouched) return state;
      const tick = state.tick + 1;
      const nextWindows = state.windows.map((w, i) =>
        i === idx ? { ...w, lastTouchedAt: tick } : w,
      );
      return { ...state, windows: nextWindows, tick };
    }
    case "beginClose": {
      // Idempotent: a `beginClose` while already closing is a no-op
      // so cleanup tears down safely if a stray timer fires twice.
      if (state.phase === "closing") return state;
      return { ...state, phase: "closing" };
    }
    case "reset":
      return {
        windows: [],
        cursor: 0,
        nextKey: state.nextKey + 1,
        tick: 0,
        phase: "running",
      };
  }
}

function frameDwellMs(frame: DemoFrame): number {
  return (frame.typingMs ?? 0) + frame.durationMs;
}

/**
 * Per-thread window layout — position, width, and height. Each
 * window picks a different point along both axes so the four
 * windows fan across the wallpaper in a deliberate cascade
 * (instead of all four hugging a corner), and each one declares a
 * different `width`/`maxHeight` so the surface reads as a populated
 * desktop with windows of varied content rather than four identical
 * IM panes. Some overlap is intentional — real desktop windows
 * overlap, and the manager already raises the most-recently-touched
 * window via `lastTouchedAt` -> `zByThread` so the cascade reads
 * correctly when windows do collide.
 */
interface ThreadLayout {
  readonly top?: string;
  readonly left?: string;
  readonly right?: string;
  readonly bottom?: string;
  readonly width: string;
  readonly maxHeight: string;
}

const THREAD_POSITIONS: Readonly<Record<ThreadId, ThreadLayout>> = {
  architect_frontend: {
    top: "6%",
    left: "4%",
    width: "280px",
    maxHeight: "320px",
  },
  architect_backend: {
    top: "14%",
    right: "12%",
    width: "260px",
    maxHeight: "280px",
  },
  backend_reviewer: {
    top: "46%",
    left: "22%",
    width: "240px",
    maxHeight: "220px",
  },
  frontend_reviewer: {
    bottom: "8%",
    right: "4%",
    width: "250px",
    maxHeight: "240px",
  },
};

export function DMWindowManager(): ReactNode {
  const [state, dispatch] = useReducer(managerReducer, INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The lifecycle effect now drives a three-step chain rather than
  // the old two-step (advance → reset). When the script ends:
  //   1. While `phase === "running"` and `cursor >= SCRIPT.length`,
  //      hold for `END_DWELL_MS` so the final frame lingers, then
  //      dispatch `beginClose`.
  //   2. While `phase === "closing"`, wait for the longest
  //      per-window close animation (`WINDOW_CLOSE_MS + (n - 1) *
  //      STAGGER`) to finish, then dispatch `reset` — the cascade
  //      tears down in reverse z-order via the inline animation-
  //      delay on each window and the loop restarts cleanly.
  // Until `cursor >= SCRIPT.length` the effect still schedules the
  // next `advance` after the prior frame's dwell, just like before.
  // The window count `state.windows.length` is read inside the
  // effect (NOT as a dep) because by the time we land in the
  // closing branch the manager has already settled on its final
  // window set, so re-running this effect on every per-window
  // append would add no value.
  useEffect(() => {
    if (state.phase === "closing") {
      const totalClose =
        WINDOW_CLOSE_MS +
        Math.max(0, state.windows.length - 1) * WINDOW_CLOSE_STAGGER_MS;
      timerRef.current = setTimeout(() => {
        dispatch({ type: "reset" });
      }, totalClose);
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }

    if (state.cursor >= SCRIPT.length) {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "beginClose" });
      }, END_DWELL_MS);
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }

    const previousFrame =
      state.cursor === 0 ? null : SCRIPT[state.cursor - 1];
    const wait = previousFrame ? frameDwellMs(previousFrame) : 250;

    timerRef.current = setTimeout(() => {
      dispatch({ type: "advance" });
    }, wait);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state.cursor, state.phase, state.windows.length]);

  // Stable callback the child windows use to nudge their thread to
  // the top of the z-index stack on mouse-down / drag / resize.
  // Routes into the reducer's `focus` action, which bumps the
  // thread's `lastTouchedAt` so `zByThread` and `focusedThreadId`
  // below promote the clicked window above its peers — same
  // mechanism the script-driven frame advance uses.
  const focusThread = useCallback((threadId: ThreadId) => {
    dispatch({ type: "focus", threadId });
  }, []);

  // Pre-compute the z-index ordering for the current windows array.
  // Higher `lastTouchedAt` -> higher z-index. Z bumps in steps of 1
  // starting at a base of 10 so the wallpaper (0) and vignette (1)
  // always paint behind every DM window.
  const zByThread = useMemo<ReadonlyMap<ThreadId, number>>(() => {
    const sorted = [...state.windows].sort(
      (a, b) => a.lastTouchedAt - b.lastTouchedAt,
    );
    const map = new Map<ThreadId, number>();
    sorted.forEach((w, i) => {
      map.set(w.threadId, 10 + i);
    });
    return map;
  }, [state.windows]);

  // The window whose thread most recently received a frame is the
  // "focused" one and paints with the heavier `.dmWindowFocused`
  // drop shadow. We pick the max `lastTouchedAt` here so the
  // selection stays in sync with `zByThread` (whichever window is
  // visually on top is also the focused one).
  const focusedThreadId = useMemo<ThreadId | null>(() => {
    if (state.windows.length === 0) return null;
    let best = state.windows[0];
    for (const w of state.windows) {
      if (w.lastTouchedAt > best.lastTouchedAt) best = w;
    }
    return best.threadId;
  }, [state.windows]);

  // Per-thread close stagger. Only computed once the manager flips
  // to `closing`. Sort threads by descending z-index so the
  // most-recently-focused window (top of the cascade) closes first
  // and the bottom-most window closes last — feels like a tidy
  // tear-down of the stack rather than every window snapping shut
  // in sync. We assign delays in this order so each window's
  // `animation-delay` becomes `index * STAGGER`.
  const closeDelayByThread = useMemo<ReadonlyMap<ThreadId, number>>(() => {
    if (state.phase !== "closing") return new Map();
    const sortedByZDesc = [...state.windows].sort(
      (a, b) => b.lastTouchedAt - a.lastTouchedAt,
    );
    const map = new Map<ThreadId, number>();
    sortedByZDesc.forEach((w, i) => {
      map.set(w.threadId, i * WINDOW_CLOSE_STAGGER_MS);
    });
    return map;
  }, [state.phase, state.windows]);

  const isClosing = state.phase === "closing";

  return (
    <div
      className={styles.windowManager}
      data-testid="dm-window-manager"
      aria-hidden="true"
    >
      {state.windows.map((win) => {
        const meta = THREADS[win.threadId];
        const position = THREAD_POSITIONS[win.threadId];
        const z = zByThread.get(win.threadId) ?? 10;
        const frames: ReadonlyArray<DMWindowFrame> = win.frames.map(
          ({ key, frame }) => ({ key, frame }),
        );
        return (
          <DMWindow
            key={win.threadId}
            threadId={win.threadId}
            participants={meta.participants}
            frames={frames}
            zIndex={z}
            position={position}
            isFocused={win.threadId === focusedThreadId}
            onFocus={focusThread}
            isClosing={isClosing}
            closeDelayMs={closeDelayByThread.get(win.threadId) ?? 0}
          />
        );
      })}
    </div>
  );
}
