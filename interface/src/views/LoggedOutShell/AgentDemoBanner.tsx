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
} from "./agent-demo-script";
import { TypingIndicator } from "./TypingIndicator";
import { TypewriterText } from "./TypewriterText";
import styles from "./LoggedOutShell.module.css";

/**
 * Decorative looping multi-agent demo that replaces the static
 * "What do you want to create?" hero on the logged-out homepage.
 *
 * The component walks `SCRIPT` (see `./agent-demo-script.ts`) on a
 * `setTimeout` chain, appending one frame at a time, then resets to
 * the start when the script is exhausted. Older frames stay rendered
 * above the latest one but the visible window is capped to
 * `MAX_VISIBLE` so the banner never overflows its fixed height.
 *
 * Each frame is one row. When a frame declares `typingMs`, the row
 * first renders a `TypingIndicator` and then cross-fades the bubble
 * into the resolved content (message text or tool card) — typing
 * and message are NOT two separate stacked entries. Message bubbles
 * render their text through `TypewriterText`, which streams the
 * copy character-by-character with a trailing block caret so the
 * resolved bubble feels like a live LLM response being written
 * (rather than a wholesale "text appears" pop).
 *
 * The whole banner is `aria-hidden`: it's atmosphere, not content.
 * The chat input below the banner remains the keyboard-reachable
 * surface for visitors.
 *
 * `prefers-reduced-motion` handling: the timeline ALWAYS plays —
 * the demo is the entire point of the hero, so freezing it for
 * reduced-motion users would just leave a static empty rectangle
 * with no information value. The CSS layer instead disables the
 * per-row slide-in, the bubble cross-fade, and the typing-dot
 * bounce under that media query, so reduced-motion users still see
 * frames advance through the panel, just without any per-row motion
 * side effects.
 */

/**
 * Maximum number of frames rendered inside the banner at once. Tuned
 * against the banner's 360px height + ~70-110px per frame so the
 * tallest combination (two messages + a 4-line tool card) still fits
 * without forcing the inner panel to scroll. The mask-image fade on
 * the inner container softens the top edge regardless of how many
 * frames are visible.
 */
const MAX_VISIBLE = 4;

/**
 * Visible window state: we keep frames keyed by a monotonically
 * increasing id so the same script frame can re-appear after a loop
 * reset without React reusing the old DOM node (which would skip the
 * entry animation).
 */
interface KeyedFrame {
  readonly key: number;
  readonly frame: DemoFrame;
}

type DemoState = {
  readonly visible: ReadonlyArray<KeyedFrame>;
  /** Index of the next frame in `SCRIPT` to play. */
  readonly cursor: number;
  /** Monotonic counter for `KeyedFrame.key`. */
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

/** Wall-clock dwell time for a frame on screen as the latest entry,
 *  combining its optional typing pre-roll with its resolved-content
 *  duration. Centralised here so the reducer's advance scheduling
 *  and the per-row swap timing stay in lock-step (the row swaps to
 *  content at `typingMs`, the reducer advances at this sum). */
function frameDwellMs(frame: DemoFrame): number {
  return (frame.typingMs ?? 0) + frame.durationMs;
}

export function AgentDemoBanner(): ReactNode {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.cursor >= SCRIPT.length) {
      // Loop reset: brief breather, then start the script again so
      // visitors who linger see a continuous demo. The breather
      // doubles as a beat between the architect's final "Shipped..."
      // line and the architect's next opening "Let's ship..." line —
      // makes the loop feel intentional rather than abrupt.
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

    // The cursor's *previous* frame controls how long the latest
    // entry sits before we advance. On the first tick (cursor === 0)
    // we kick off immediately with a tiny delay so the entry
    // animation has a frame to mount. For a frame with a typing
    // pre-roll, the wait spans `typingMs + durationMs` so the row
    // gets its full typing beat AND its full resolved-content beat
    // before the next row stacks on top.
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

/**
 * A single row in the demo. When `frame.typingMs` is set, the row
 * starts in `phase: "typing"` and a row-local `setTimeout` flips it
 * to `phase: "content"` after `typingMs`. The bubble is keyed per
 * phase so the unmount/mount triggers the `demoBubblePhase` fade-in
 * animation defined in CSS — the visual effect is the typing dots
 * cross-fading into the resolved bubble within the same row, rather
 * than the typing landing as a separate stacked entry.
 *
 * Frames without `typingMs` skip the typing phase entirely and start
 * directly in `content`, so the architect's closing "Shipped..." line
 * (and any other instant frame) lands without an unnecessary pre-roll.
 */
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
        {phase === "typing" ? (
          <div
            key="typing"
            className={`${styles.demoBubble} ${styles.demoTypingBubble} ${styles.demoBubblePhase}`}
          >
            <TypingIndicator color={agent.color} />
          </div>
        ) : frame.kind === "message" ? (
          <div
            key="content"
            className={`${styles.demoBubble} ${styles.demoBubblePhase}`}
          >
            <TypewriterText text={frame.text} />
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
