import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Minus, Square, X } from "lucide-react";
import { TerminalStream } from "../TerminalStream";
import { TypewriterText } from "../TypewriterText";
import { TypingIndicator } from "../TypingIndicator";
import {
  AGENTS,
  type AgentId,
  type DemoFrame,
  type ThreadId,
} from "../agent-demo-script";
import styles from "./DMWindow.module.css";

/**
 * One floating DM window mounted by `DMWindowManager`. Renders the
 * MSN/ICQ-style chrome (titlebar with both participants' names +
 * fake window controls, status strip, message body) and projects
 * the script's frames into the body — message frames render as
 * bubbles aligned left/right based on the speaking agent, tool
 * frames render as compact mono-font cards reusing `TerminalStream`.
 *
 * The body auto-scrolls to the bottom when a new frame is appended
 * and keeps older messages around so the conversation reads like a
 * persistent IM thread rather than a single live frame.
 *
 * Bubble alignment: the first participant in `participants` is the
 * "left side" of the conversation, the second is the "right side".
 * Each agent's bubble takes its accent colour from `AGENTS[id]`.
 *
 * The whole window is decorative — the parent manager already
 * applies `aria-hidden`, but each window also marks its body so a
 * future change that lifts a window into a non-decorative parent
 * doesn't accidentally leak the looping content into assistive tech.
 */

export interface DMWindowFrame {
  readonly key: number;
  readonly frame: DemoFrame;
}

export interface DMWindowPosition {
  readonly top?: string;
  readonly left?: string;
  readonly right?: string;
  readonly bottom?: string;
}

interface DMWindowProps {
  readonly threadId: ThreadId;
  readonly participants: readonly [AgentId, AgentId];
  readonly title: string;
  readonly frames: ReadonlyArray<DMWindowFrame>;
  readonly zIndex: number;
  readonly position: DMWindowPosition;
  readonly onFocus: (threadId: ThreadId) => void;
}

export function DMWindow({
  threadId,
  participants,
  title,
  frames,
  zIndex,
  position,
  onFocus,
}: DMWindowProps): ReactNode {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const registerRow = useFlipRows(frames.map((f) => f.key));

  // Auto-scroll to the bottom whenever a new frame lands so the
  // most recent message is always visible inside the window. We
  // scroll the actual body container (not the page) and only run
  // when the frame count changes; React batches updates inside the
  // reducer so this fires once per appended frame.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [frames.length]);

  const handleFocus = useCallback(() => {
    onFocus(threadId);
  }, [onFocus, threadId]);

  const containerStyle: CSSProperties = {
    zIndex,
    top: position.top,
    left: position.left,
    right: position.right,
    bottom: position.bottom,
  };

  const [leftAgent, rightAgent] = participants;
  const leftMeta = AGENTS[leftAgent];
  const rightMeta = AGENTS[rightAgent];

  return (
    <div
      className={styles.dmWindow}
      style={containerStyle}
      data-thread-id={threadId}
      data-testid={`dm-window-${threadId}`}
      onMouseDown={handleFocus}
    >
      <div className={styles.dmTitlebar}>
        <div className={styles.dmTitleParticipants}>
          <ParticipantDot agentId={leftAgent} />
          <span className={styles.dmTitleName}>{leftMeta.name}</span>
          <span className={styles.dmTitleSep}>·</span>
          <ParticipantDot agentId={rightAgent} />
          <span className={styles.dmTitleName}>{rightMeta.name}</span>
        </div>
        <div className={styles.dmControls}>
          <span className={styles.dmControl}>
            <Minus size={9} strokeWidth={2.4} />
          </span>
          <span className={styles.dmControl}>
            <Square size={8} strokeWidth={2.4} />
          </span>
          <span className={styles.dmControl}>
            <X size={9} strokeWidth={2.4} />
          </span>
        </div>
      </div>

      <div className={styles.dmStatus} title={title}>
        <span className={styles.dmStatusDot} />
        <span className={styles.dmStatusText}>{title}</span>
      </div>

      <div className={styles.dmBody} ref={bodyRef} aria-hidden="true">
        {frames.map(({ key, frame }) => (
          <DMFrameRow
            key={key}
            frame={frame}
            participants={participants}
            rowRef={registerRow(key)}
          />
        ))}
      </div>
    </div>
  );
}

interface ParticipantDotProps {
  readonly agentId: AgentId;
}

function ParticipantDot({ agentId }: ParticipantDotProps): ReactNode {
  const agent = AGENTS[agentId];
  return (
    <span
      className={styles.dmParticipantDot}
      style={{
        background: `linear-gradient(135deg, ${agent.gradient.from} 0%, ${agent.gradient.to} 100%)`,
        borderColor: `${agent.color}aa`,
      }}
    />
  );
}

interface DMFrameRowProps {
  readonly frame: DemoFrame;
  readonly participants: readonly [AgentId, AgentId];
  readonly rowRef?: (el: HTMLDivElement | null) => void;
}

function DMFrameRow({
  frame,
  participants,
  rowRef,
}: DMFrameRowProps): ReactNode {
  const agent = AGENTS[frame.agent];
  const isRightSide = frame.agent === participants[1];
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
    <div
      className={`${styles.dmRow} ${
        isRightSide ? styles.dmRowRight : styles.dmRowLeft
      }`}
      ref={rowRef}
    >
      <span className={styles.dmRowSender} style={{ color: agent.color }}>
        {agent.name}
      </span>
      {frame.kind === "message" ? (
        // Single bubble container that persists across the typing
        // -> content swap, mirroring the morph behavior the previous
        // banner used: the bubble's pop animation runs once, the
        // inner slot remounts to swap dots for the typewriter.
        <div
          className={`${styles.dmBubble} ${styles.dmBubblePhase} ${
            isRightSide ? styles.dmBubbleRight : styles.dmBubbleLeft
          } ${phase === "typing" ? styles.dmTypingBubble : ""}`}
          style={isRightSide ? { borderColor: `${agent.color}55` } : undefined}
        >
          <span key={phase} className={styles.dmBubbleSlot}>
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
          className={`${styles.dmBubble} ${styles.dmTypingBubble} ${styles.dmBubblePhase} ${
            isRightSide ? styles.dmBubbleRight : styles.dmBubbleLeft
          }`}
        >
          <TypingIndicator color={agent.color} />
        </div>
      ) : (
        <div
          key="content"
          className={`${styles.dmToolCard} ${styles.dmBubblePhase} ${
            isRightSide ? styles.dmBubbleRight : styles.dmBubbleLeft
          }`}
          style={{ borderColor: `${agent.color}66` }}
        >
          <div className={styles.dmToolHeader}>
            <span
              className={styles.dmToolName}
              style={{ color: agent.color }}
            >
              {frame.toolName}
            </span>
            {frame.target ? (
              <span className={styles.dmToolTarget}>{frame.target}</span>
            ) : null}
          </div>
          <TerminalStream lines={frame.preview} language={frame.language} />
        </div>
      )}
    </div>
  );
}

/**
 * FLIP (First-Last-Invert-Play) row animator scoped to a single DM
 * window's body. Identical motion to the previous banner's helper:
 * when a new row is appended at the bottom of the body, every
 * existing row's position shifts up by `(newRowHeight + gap)`. This
 * hook captures each row's top via `useLayoutEffect`, applies an
 * inverse `translateY(<delta>)` synchronously, and on the next
 * animation frame transitions back to `transform: ''` so the
 * existing rows glide up smoothly alongside the new row's
 * `dmRowEnter` keyframe.
 *
 * Lives next to `DMWindow` (rather than being shared with the old
 * banner) so each DM window measures its own body and the
 * positions map can drop refs as windows are torn down on script
 * reset without leaking entries from the previous run.
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
          "transform 480ms cubic-bezier(0.165, 0.84, 0.44, 1)";
        el.style.transform = "";
      });
    });

    positions.current = next;
    for (const key of Array.from(refs.current.keys())) {
      if (!next.has(key)) refs.current.delete(key);
    }
  }, [visibleKeys]);

  return useCallback(
    (key: number) => (el: HTMLDivElement | null) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },
    [],
  );
}
