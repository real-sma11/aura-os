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
 * Static positions for each DM window inside the wallpaper area.
 * Coordinates are CSS percentages relative to the wallpaper body,
 * laid out so the four windows tile across the corners with a
 * gentle off-axis stagger that matches the cascading-window feel
 * of classic IM clients. A small idle drift animation (see
 * `.dmWindow` in the CSS module) gives each window a touch of life
 * so the panel doesn't read as "static screenshot" once a window
 * settles.
 */
const THREAD_POSITIONS: Readonly<Record<ThreadId, { top?: string; left?: string; right?: string; bottom?: string }>> = {
  architect_frontend: { top: "8%", left: "5%" },
  architect_backend: { top: "10%", right: "6%" },
  backend_reviewer: { bottom: "8%", left: "8%" },
  frontend_reviewer: { bottom: "12%", right: "5%" },
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
            onFocus={focusThread}
          />
        );
      })}
    </div>
  );
}
