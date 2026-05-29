import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TypewriterText } from "../../public-chat/TypewriterText";
import { TypingIndicator } from "../../public-chat/TypingIndicator";
import { TerminalStream } from "../../public-chat/TerminalStream";
import {
  AGENTS,
  type MobileConversation,
  type MobileFrame,
} from "./mobile-chat-script";
import styles from "./MockMobileChat.module.css";

/**
 * Wall-clock the thread holds at its final frame before clearing and
 * looping from the top, so a lingering visitor sees the closing
 * agent line resolve before the conversation restarts.
 */
const END_DWELL_MS = 2600;

/**
 * Brief pause after the transcript clears before the first frame of
 * the next pass appears — reads as the agent "coming back" rather
 * than an instant jump-cut back to frame 0.
 */
const RESET_GAP_MS = 600;

interface KeyedFrame {
  readonly key: number;
  readonly frame: MobileFrame;
}

type Phase = "running" | "resetting";

interface PlaybackState {
  readonly visible: ReadonlyArray<KeyedFrame>;
  readonly cursor: number;
  readonly nextKey: number;
  readonly phase: Phase;
}

type PlaybackAction =
  | { type: "advance"; frames: ReadonlyArray<MobileFrame> }
  | { type: "beginReset" }
  | { type: "reset" };

const INITIAL_STATE: PlaybackState = {
  visible: [],
  cursor: 0,
  nextKey: 0,
  phase: "running",
};

function playbackReducer(
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackState {
  switch (action.type) {
    case "advance": {
      if (state.phase !== "running" || state.cursor >= action.frames.length) {
        return state;
      }
      const frame = action.frames[state.cursor];
      return {
        ...state,
        visible: [...state.visible, { key: state.nextKey, frame }],
        cursor: state.cursor + 1,
        nextKey: state.nextKey + 1,
      };
    }
    case "beginReset": {
      if (state.phase === "resetting") return state;
      // Clear the transcript but stay paused — the effect schedules
      // the `reset` that flips back to `running` after `RESET_GAP_MS`.
      return { ...state, visible: [], phase: "resetting" };
    }
    case "reset": {
      return {
        visible: [],
        cursor: 0,
        nextKey: state.nextKey + 1,
        phase: "running",
      };
    }
  }
}

function frameDwellMs(frame: MobileFrame): number {
  return (frame.typingMs ?? 0) + frame.durationMs;
}

interface MockMobileChatProps {
  readonly conversation: MobileConversation;
}

/**
 * A single looping mobile chat mockup painted inside a `PhoneShell`
 * screen on the `/product` page. Renders a messaging-app surface —
 * an agent header, an auto-scrolling transcript (your prompts on the
 * right, the agent's typed replies and streamed tool cards on the
 * left), and a decorative input bar — then walks
 * `conversation.frames` on a `setTimeout` chain, dwelling at the end
 * and looping from the top.
 *
 * The animation primitives (`TypewriterText`, `TypingIndicator`,
 * `TerminalStream`) are shared with the desktop landing hero so the
 * two surfaces stay visually consistent. The whole subtree is
 * decorative atmosphere: it's `aria-hidden`, and `PhoneShell`'s
 * `ariaLabel` supplies the accessible name for the frame.
 */
export function MockMobileChat({
  conversation,
}: MockMobileChatProps): ReactNode {
  const [state, dispatch] = useReducer(playbackReducer, INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { frames } = conversation;
  const agent = AGENTS[conversation.agentId];

  useEffect(() => {
    if (state.phase === "resetting") {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "reset" });
      }, RESET_GAP_MS);
    } else if (state.cursor >= frames.length) {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "beginReset" });
      }, END_DWELL_MS);
    } else {
      const previousFrame =
        state.cursor === 0 ? null : frames[state.cursor - 1];
      const wait = previousFrame ? frameDwellMs(previousFrame) : 400;
      timerRef.current = setTimeout(() => {
        dispatch({ type: "advance", frames });
      }, wait);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state.cursor, state.phase, frames]);

  // Keep the newest row pinned to the bottom as the thread fills.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [state.visible]);

  return (
    <div
      className={styles.mobileChat}
      style={{ "--agent-color": agent.color } as React.CSSProperties}
      aria-hidden="true"
    >
      <header className={styles.header}>
        <span
          className={styles.avatar}
          style={{
            backgroundImage: `linear-gradient(135deg, ${agent.gradient.from}, ${agent.gradient.to})`,
          }}
        >
          <agent.Icon className={styles.avatarIcon} strokeWidth={2.25} />
        </span>
        <span className={styles.headerText}>
          <span className={styles.headerName}>{agent.name}</span>
          <span className={styles.headerSubtitle}>{conversation.subtitle}</span>
        </span>
      </header>

      <div className={styles.transcript} ref={scrollRef}>
        {state.visible.map(({ key, frame }) => (
          <MobileRow key={key} frame={frame} accent={agent.color} />
        ))}
      </div>

      <div className={styles.inputBar}>
        <span className={styles.inputField}>Message your agent…</span>
        <span className={styles.sendButton} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <path
              d="M4 12l16-8-6 16-3-7-7-1z"
              fill="currentColor"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

interface MobileRowProps {
  readonly frame: MobileFrame;
  readonly accent: string;
}

/**
 * One row in the transcript. User frames render a right-aligned
 * bubble with their text shown immediately. Agent frames render on
 * the left: if the frame declares a `typingMs` pre-roll the row
 * first shows the `TypingIndicator` for that many ms, then swaps to
 * the resolved content (a streamed message bubble or a tool card).
 * Each row owns its own typing timer and replays on mount, so the
 * transcript clear + loop in `MockMobileChat` naturally re-runs the
 * typing beat on the next pass.
 */
function MobileRow({ frame, accent }: MobileRowProps): ReactNode {
  const isUser = frame.from === "user";
  const typingMs = isUser ? 0 : frame.typingMs ?? 0;
  // Initial state already reflects whether this row opens on a typing
  // beat, and the row mounts fresh each loop pass (it's keyed by the
  // frame's playback key), so the effect only needs to schedule the
  // transition OUT of the typing phase — no synchronous setState.
  const [isTyping, setIsTyping] = useState<boolean>(typingMs > 0);

  useEffect(() => {
    if (typingMs <= 0) return;
    const handle = setTimeout(() => setIsTyping(false), typingMs);
    return () => clearTimeout(handle);
  }, [typingMs]);

  if (isUser) {
    return (
      <div className={`${styles.row} ${styles.rowUser}`}>
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
          {frame.kind === "message" ? frame.text : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.row} ${styles.rowAgent}`}>
      {isTyping ? (
        <div className={`${styles.bubble} ${styles.bubbleAgent} ${styles.bubbleTyping}`}>
          <TypingIndicator color={accent} />
        </div>
      ) : frame.kind === "message" ? (
        <div className={`${styles.bubble} ${styles.bubbleAgent}`}>
          <TypewriterText text={frame.text} />
        </div>
      ) : (
        <div className={styles.toolCard} style={{ borderColor: accent }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName} style={{ color: accent }}>
              {frame.toolName}
            </span>
            {frame.target ? (
              <span className={styles.toolTarget}>{frame.target}</span>
            ) : null}
          </div>
          <TerminalStream lines={frame.preview} language={frame.language} />
        </div>
      )}
    </div>
  );
}
