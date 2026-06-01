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

/**
 * On loop reset the transcript doesn't clear all at once — rows fade
 * out one at a time (newest first). `FADE_OUT_MS` is how long each
 * row plays its exit animation before it's unmounted, and
 * `FADE_OUT_STAGGER_MS` is the gap before the next row begins fading,
 * so the thread "unwinds" rather than blinking out.
 */
const FADE_OUT_MS = 260;
const FADE_OUT_STAGGER_MS = 90;

interface KeyedFrame {
  readonly key: number;
  readonly frame: MobileFrame;
}

type Phase = "running" | "fadingOut" | "resetting";

interface PlaybackState {
  readonly visible: ReadonlyArray<KeyedFrame>;
  readonly cursor: number;
  readonly nextKey: number;
  readonly phase: Phase;
  /** Key of the row currently playing its fade-out, if any. */
  readonly exitingKey: number | null;
}

type PlaybackAction =
  | { type: "advance"; frames: ReadonlyArray<MobileFrame> }
  | { type: "beginFadeOut" }
  | { type: "markExit" }
  | { type: "removeExited" }
  | { type: "beginReset" }
  | { type: "reset" };

const INITIAL_STATE: PlaybackState = {
  visible: [],
  cursor: 0,
  nextKey: 0,
  phase: "running",
  exitingKey: null,
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
    case "beginFadeOut": {
      if (state.phase !== "running") return state;
      return { ...state, phase: "fadingOut" };
    }
    case "markExit": {
      // Tag the newest still-visible row so it plays its exit
      // animation; the effect removes it after `FADE_OUT_MS`.
      if (state.phase !== "fadingOut" || state.exitingKey !== null) {
        return state;
      }
      const last = state.visible.at(-1);
      if (!last) return state;
      return { ...state, exitingKey: last.key };
    }
    case "removeExited": {
      if (state.exitingKey === null) return state;
      return {
        ...state,
        visible: state.visible.filter((row) => row.key !== state.exitingKey),
        exitingKey: null,
      };
    }
    case "beginReset": {
      if (state.phase === "resetting") return state;
      // Transcript is already empty here — just stay paused while the
      // effect schedules the `reset` that flips back to `running`.
      return { ...state, visible: [], phase: "resetting", exitingKey: null };
    }
    case "reset": {
      return {
        visible: [],
        cursor: 0,
        nextKey: state.nextKey + 1,
        phase: "running",
        exitingKey: null,
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
  const inputPrompt = firstUserPrompt(conversation);

  useEffect(() => {
    if (state.phase === "resetting") {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "reset" });
      }, RESET_GAP_MS);
    } else if (state.phase === "fadingOut") {
      if (state.visible.length === 0) {
        // Every row has faded — hand off to the reset gap.
        timerRef.current = setTimeout(() => {
          dispatch({ type: "beginReset" });
        }, 0);
      } else if (state.exitingKey === null) {
        // Stagger before tagging the next (newest) row to fade.
        timerRef.current = setTimeout(() => {
          dispatch({ type: "markExit" });
        }, FADE_OUT_STAGGER_MS);
      } else {
        // A row is mid-fade — unmount it once its animation finishes.
        timerRef.current = setTimeout(() => {
          dispatch({ type: "removeExited" });
        }, FADE_OUT_MS);
      }
    } else if (state.cursor >= frames.length) {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "beginFadeOut" });
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
  }, [
    state.cursor,
    state.phase,
    state.visible.length,
    state.exitingKey,
    frames,
  ]);

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
      style={{ "--agent-color": conversation.accent } as React.CSSProperties}
      aria-hidden="true"
    >
      <header className={styles.header}>
        <span
          className={styles.avatar}
          style={{ backgroundColor: conversation.accent }}
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
          <MobileRow
            key={key}
            frame={frame}
            accent={conversation.accent}
            isExiting={key === state.exitingKey}
          />
        ))}
      </div>

      <ComposeInput prompt={inputPrompt} />
    </div>
  );
}

/**
 * The phrase the input bar "types" before sending. Reuses the
 * conversation's opening user prompt so the demo input mirrors how
 * the visitor would actually start the thread; falls back to a
 * generic prompt if the script opens on something else.
 */
function firstUserPrompt(conversation: MobileConversation): string {
  for (const frame of conversation.frames) {
    if (frame.from === "user" && frame.kind === "message") {
      return frame.text;
    }
  }
  return "Message your agent…";
}

/** Phases the decorative compose bar cycles through forever. */
type ComposePhase = "idle" | "typing" | "sending";

const COMPOSE_IDLE_MS = 900;
const COMPOSE_TYPE_MS = 55;
const COMPOSE_HOLD_MS = 650;
const COMPOSE_SEND_MS = 420;

interface ComposeInputProps {
  readonly prompt: string;
}

/**
 * Decorative input bar that loops through a "write then send" beat:
 * it types `prompt` one character at a time, holds the finished line,
 * pulses the send button (the "sent" beat), then clears back to the
 * placeholder and starts over. Purely atmospheric — the whole chat
 * subtree is `aria-hidden`.
 */
function ComposeInput({ prompt }: ComposeInputProps): ReactNode {
  const [phase, setPhase] = useState<ComposePhase>("idle");
  const [shown, setShown] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (phase === "idle") {
      timerRef.current = setTimeout(() => {
        setShown(0);
        setPhase("typing");
      }, COMPOSE_IDLE_MS);
    } else if (phase === "typing") {
      if (shown >= prompt.length) {
        timerRef.current = setTimeout(() => setPhase("sending"), COMPOSE_HOLD_MS);
      } else {
        timerRef.current = setTimeout(
          () => setShown((n) => n + 1),
          COMPOSE_TYPE_MS,
        );
      }
    } else {
      // sending — pulse the button, then clear and loop.
      timerRef.current = setTimeout(() => {
        setShown(0);
        setPhase("idle");
      }, COMPOSE_SEND_MS);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, shown, prompt]);

  const typed = prompt.slice(0, shown);
  const isTyping = phase === "typing";
  const isSending = phase === "sending";
  const hasText = typed.length > 0;

  return (
    <div className={styles.inputBar}>
      <span
        className={`${styles.inputField} ${hasText ? styles.inputFieldActive : ""}`}
      >
        {hasText ? typed : "Message your agent…"}
        {isTyping ? <span className={styles.composeCaret} /> : null}
      </span>
      <span
        className={`${styles.sendButton} ${isSending ? styles.sendButtonActive : ""}`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
          <path d="M4 12l16-8-6 16-3-7-7-1z" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

interface MobileRowProps {
  readonly frame: MobileFrame;
  readonly accent: string;
  /** When true the row plays its fade-out before being unmounted. */
  readonly isExiting: boolean;
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
 *
 * On loop reset the parent tags rows as `isExiting` newest-first; the
 * `rowExiting` class plays a fade+collapse so the thread unwinds one
 * bubble at a time instead of clearing in a single jump.
 */
function MobileRow({ frame, accent, isExiting }: MobileRowProps): ReactNode {
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

  const exitClass = isExiting ? ` ${styles.rowExiting}` : "";

  if (isUser) {
    return (
      <div className={`${styles.row} ${styles.rowUser}${exitClass}`}>
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
          {frame.kind === "message" ? frame.text : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.row} ${styles.rowAgent}${exitClass}`}>
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
