import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AGENTS,
  SCRIPT,
  type AgentId,
  type DemoFrame,
} from "../agent-demo-script";
import { TypingIndicator } from "../TypingIndicator";
import { TypewriterText } from "../TypewriterText";
import styles from "./AgentDemoBanner.module.css";

/**
 * Decorative looping multi-agent demo that replaces the static
 * "What do you want to create?" hero on the logged-out homepage.
 *
 * The component walks `SCRIPT` (see `../agent-demo-script.ts`) on a
 * `setTimeout` chain, appending one frame at a time, then resets to
 * the start when the script is exhausted. Older frames stay rendered
 * above the latest one but the visible window is capped to
 * `MAX_VISIBLE` so the banner never overflows its fixed height.
 *
 * Each frame is one row. When a frame declares `typingMs`, the row
 * first renders a `TypingIndicator` and then morphs in place into
 * the resolved content — typing and message are NOT two separate
 * stacked entries.
 *
 * For message frames the bubble container is mounted ONCE (animating
 * open with the row's pop-in) and persists across the typing ->
 * content swap; only the inner slot (dots vs typewriter) remounts,
 * so the user sees "the same open bubble" continuing to hold the
 * agent's reply rather than a fresh bubble appearing where the dots
 * used to be. Message bubbles render their text through
 * `TypewriterText`, which streams the copy character-by-character
 * with a trailing block caret so the resolved bubble feels like a
 * live LLM response being written (rather than a wholesale "text
 * appears" pop).
 *
 * Tool frames keep the swap-shape behavior (small typing bubble ->
 * wider tool card) because their visual shapes differ too much to
 * share a single morphing container — the typing bubble exits and
 * the tool card enters with its own pop-in.
 *
 * The whole banner is `aria-hidden`: it's atmosphere, not content.
 * The chat input below the banner remains the keyboard-reachable
 * surface for visitors.
 *
 * `prefers-reduced-motion` handling: the entire banner — script
 * timeline, row enter, bubble pop, typing-dot bounce, and message
 * typewriter — ALWAYS plays. The demo is the whole point of the
 * hero, so freezing parts of it leaves the loop visibly broken
 * (dots sit motionless, message text appears in one chunk). The
 * banner is hidden from assistive tech via `aria-hidden`, so
 * reduced-motion users lose nothing meaningful by seeing the same
 * animation everyone else sees. If a non-decorative consumer ever
 * adopts `TypingIndicator` or `TypewriterText`, that consumer
 * should add its own reduced-motion gate at the callsite.
 */

const MAX_VISIBLE = 4;

interface KeyedFrame {
  readonly key: number;
  readonly frame: DemoFrame;
}

type DemoState = {
  readonly visible: ReadonlyArray<KeyedFrame>;
  readonly cursor: number;
  readonly nextKey: number;
};

type DemoAction = { type: "advance" } | { type: "reset" };

const INITIAL_STATE: DemoState = {
  visible: [],
  cursor: 0,
  nextKey: 0,
};

function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "advance": {
      if (state.cursor >= SCRIPT.length) {
        return state;
      }
      const frame = SCRIPT[state.cursor];
      const nextVisible = [
        ...state.visible,
        { key: state.nextKey, frame },
      ].slice(-MAX_VISIBLE);
      return {
        visible: nextVisible,
        cursor: state.cursor + 1,
        nextKey: state.nextKey + 1,
      };
    }
    case "reset":
      return {
        visible: [],
        cursor: 0,
        nextKey: state.nextKey + 1,
      };
  }
}

function frameDwellMs(frame: DemoFrame): number {
  return (frame.typingMs ?? 0) + frame.durationMs;
}

export function AgentDemoBanner(): ReactNode {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_STATE);
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

  return (
    <div className={styles.composeBanner} data-testid="agent-demo-banner">
      <div className={styles.composeBannerTitle}>
        Coordinate agents while you sleep
      </div>
      <div
        className={styles.demoInner}
        data-testid="agent-demo-loop"
        aria-hidden="true"
      >
        {state.visible.map(({ key, frame }) => (
          <DemoFrameRow key={key} frame={frame} />
        ))}
      </div>
    </div>
  );
}

interface DemoFrameRowProps {
  readonly frame: DemoFrame;
}

function DemoFrameRow({ frame }: DemoFrameRowProps): ReactNode {
  const agent = AGENTS[frame.agent];
  const hasTyping = (frame.typingMs ?? 0) > 0;
  const [phase, setPhase] = useState<"typing" | "content">(
    hasTyping ? "typing" : "content",
  );

  useEffect(() => {
    if (phase !== "typing" || !frame.typingMs) {
      return;
    }
    const handle = setTimeout(() => {
      setPhase("content");
    }, frame.typingMs);
    return () => clearTimeout(handle);
  }, [phase, frame.typingMs]);

  return (
    <div className={styles.demoRow}>
      <AgentAvatar agentId={agent.id} />
      <div className={styles.demoBubbleWrap}>
        <span
          className={styles.demoAgentName}
          style={{ color: agent.color }}
        >
          {agent.name}
        </span>
        {frame.kind === "message" ? (
          // Single bubble container that persists across the
          // typing -> content swap. The bubble's pop-open animation
          // runs once at mount (no `key` change), so it stays the
          // *same open container* while the inner slot remounts to
          // swap dots for the streaming typewriter — matching the
          // user-reported "morph in place" feel rather than the
          // earlier behavior of unmounting the typing bubble and
          // mounting a fresh message bubble in its place.
          <div
            className={`${styles.demoBubble} ${styles.demoMessageBubble} ${
              styles.demoBubblePhase
            } ${phase === "typing" ? styles.demoTypingBubble : ""}`}
          >
            <span key={phase} className={styles.demoBubbleSlot}>
              {phase === "typing" ? (
                <TypingIndicator color={agent.color} />
              ) : (
                <TypewriterText text={frame.text} />
              )}
            </span>
          </div>
        ) : phase === "typing" ? (
          <div
            key="typing"
            className={`${styles.demoBubble} ${styles.demoTypingBubble} ${styles.demoBubblePhase}`}
          >
            <TypingIndicator color={agent.color} />
          </div>
        ) : (
          <div
            key="content"
            className={`${styles.demoToolCard} ${styles.demoBubblePhase}`}
            style={{ borderColor: `${agent.color}66` }}
          >
            <div className={styles.demoToolHeader}>
              <span
                className={styles.demoToolName}
                style={{ color: agent.color }}
              >
                {frame.toolName}
              </span>
              {frame.target ? (
                <span className={styles.demoToolTarget}>
                  {frame.target}
                </span>
              ) : null}
            </div>
            <pre className={styles.demoToolPreview}>
              {frame.preview.join("\n")}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentAvatarProps {
  readonly agentId: AgentId;
}

function AgentAvatar({ agentId }: AgentAvatarProps): ReactNode {
  const agent = AGENTS[agentId];
  const { Icon } = agent;
  return (
    <div
      className={styles.demoAvatar}
      style={{
        background: `linear-gradient(135deg, ${agent.gradient.from} 0%, ${agent.gradient.to} 100%)`,
        borderColor: `${agent.color}88`,
        boxShadow: `0 0 0 1px ${agent.color}22, 0 4px 10px ${agent.color}33`,
      }}
    >
      <Icon size={14} strokeWidth={2.4} color="#ffffff" aria-hidden="true" />
    </div>
  );
}
