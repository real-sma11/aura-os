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
import { DMWindow, type DMWindowFrame } from "./DMWindow";
import styles from "./DMWindowManager.module.css";

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

type ManagerState = {
  readonly windows: ReadonlyArray<ThreadWindowState>;
  readonly cursor: number;
  readonly nextKey: number;
  readonly tick: number;
};

type ManagerAction = { type: "advance" } | { type: "reset" };

const INITIAL_STATE: ManagerState = {
  windows: [],
  cursor: 0,
  nextKey: 0,
  tick: 0,
};

function managerReducer(
  state: ManagerState,
  action: ManagerAction,
): ManagerState {
  switch (action.type) {
    case "advance": {
      if (state.cursor >= SCRIPT.length) {
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
        windows: nextWindows,
        cursor: state.cursor + 1,
        nextKey: state.nextKey + 1,
        tick,
      };
    }
    case "reset":
      return {
        windows: [],
        cursor: 0,
        nextKey: state.nextKey + 1,
        tick: 0,
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

  useEffect(() => {
    if (state.cursor >= SCRIPT.length) {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "reset" });
      }, 2400);
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
  }, [state.cursor]);

  // Stable callback the child windows use to nudge their thread to
  // the top of the z-index stack. Currently the manager only bumps
  // on frame advance (via `lastTouchedAt`), but exposing this hook
  // means a future hover/focus interaction can raise the window
  // without writing into the reducer's frames map. The `threadId`
  // argument is intentionally unused for now — the decorative loop
  // has no real "focus" event today; we keep the parameter so a
  // future consumer can wire mouse interactions in without a
  // structural change. The `void threadId` line below silences the
  // unused-arg lint while still documenting the intent.
  const focusThread = useCallback((threadId: ThreadId) => {
    void threadId;
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
            title={meta.title}
            frames={frames}
            zIndex={z}
            position={position}
            isFocused={win.threadId === focusedThreadId}
            onFocus={focusThread}
          />
        );
      })}
    </div>
  );
}
