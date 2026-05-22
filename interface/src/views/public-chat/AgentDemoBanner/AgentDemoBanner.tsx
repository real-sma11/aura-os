import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { TerminalStream } from "../TerminalStream";
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

/**
 * FLIP (First-Last-Invert-Play) row animator. Without this, a new
 * row appended at the bottom of `.demoInner` (which uses
 * `flex-direction: column; justify-content: flex-end`) causes every
 * existing row to shift up by `(newRowHeight + gap)` in a single
 * frame — the new row's own `demoRowEnter` keyframe glides it in
 * elegantly, but the rest of the rows jump abruptly, breaking the
 * "one coordinated motion" feel of the loop.
 *
 * For each visible row keyed by the stable `nextKey` from the
 * reducer, this hook captures the row's top via `useLayoutEffect`
 * on every render, compares to the previous frame's position, and
 * for any row whose position changed it applies an inverse
 * `translateY(<delta>)` synchronously (so the row paints in its
 * OLD spot first), then on the next animation frame transitions
 * back to `transform: ''` over the same easing as the row enter
 * keyframe. The result: when a new row is appended, the existing
 * rows slide up smoothly alongside the new row's slide-in instead
 * of snapping to their new positions.
 *
 * The row enter animation is set to `animation: none` before the
 * inverse transform so the keyframe's `fill: both` final value
 * can't shadow the inline transform — this is safe because the
 * enter animation only runs once on initial mount of each row, and
 * after that the row should sit at its untransformed pose anyway.
 *
 * Map sweep at the end of the effect drops refs / positions for
 * keys that have scrolled off the top of the window so neither
 * map grows unbounded across the loop's many resets.
 *
 * Returns a `(key) => (el) => void` factory the consumer wires into
 * each rendered row via a ref callback prop.
 */
function useFlipRows(
  visibleKeys: ReadonlyArray<number>,
): (key: number) => (el: HTMLDivElement | null) => void {
  const positions = useRef<Map<number, number>>(new Map());
  const refs = useRef<Map<number, HTMLDivElement>>(new Map());

  useLayoutEffect(() => {
    const next = new Map<number, number>();
    refs.current.forEach((el, key) => {
      next.set(key, el.getBoundingClientRect().top);
    });

    next.forEach((newTop, key) => {
      const oldTop = positions.current.get(key);
      if (oldTop === undefined || oldTop === newTop) {
        return;
      }
      const el = refs.current.get(key);
      if (!el) return;
      const delta = oldTop - newTop;
      el.style.animation = "none";
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      // Force a reflow so the inverse transform actually paints
      // before we hand control back to the browser; without this
      // the browser can coalesce the two style writes and the
      // transition fires from `translateY(0)` -> `translateY(0)`
      // with no visible motion.
      void el.offsetHeight;
      requestAnimationFrame(() => {
        el.style.transition =
          "transform 540ms cubic-bezier(0.165, 0.84, 0.44, 1)";
        el.style.transform = "";
      });
    });

    positions.current = next;
    for (const key of Array.from(refs.current.keys())) {
      if (!next.has(key)) refs.current.delete(key);
    }
    // `visibleKeys` is the dep — the effect re-runs every time the
    // SCRIPT advances (the array identity changes because we
    // recreate it on every render). We use the array only as a
    // change-detection signal; the actual measurement comes off
    // the refs map populated by the row callback.
  }, [visibleKeys]);

  return useCallback(
    (key: number) => (el: HTMLDivElement | null) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },
    [],
  );
}

export function AgentDemoBanner(): ReactNode {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registerRow = useFlipRows(state.visible.map((v) => v.key));

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
          <DemoFrameRow key={key} frame={frame} rowRef={registerRow(key)} />
        ))}
      </div>
    </div>
  );
}

interface DemoFrameRowProps {
  readonly frame: DemoFrame;
  /**
   * Ref callback wired in by `useFlipRows` so the parent can
   * measure the row's bounding rect across renders and apply
   * inverse transforms when the row's position shifts. Optional so
   * the component can be unit-tested in isolation without the FLIP
   * hook on the parent.
   */
  readonly rowRef?: (el: HTMLDivElement | null) => void;
}

function DemoFrameRow({ frame, rowRef }: DemoFrameRowProps): ReactNode {
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
    <div className={styles.demoRow} ref={rowRef}>
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
            <TerminalStream lines={frame.preview} language={frame.language} />
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
