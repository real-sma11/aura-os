import {
  useCallback,
  useEffect,
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
  /**
   * Optional per-window footprint. When supplied, the inline style
   * applies `width` / `maxHeight` so the manager can vary each
   * window's size — a long thread reads as a "tall" window, a
   * short thread reads as a compact one, matching how real
   * desktop windows differ. The CSS module still supplies a
   * `min-width` floor and responsive overrides below 720/540px.
   */
  readonly width?: string;
  readonly maxHeight?: string;
}

interface DMWindowProps {
  readonly threadId: ThreadId;
  readonly participants: readonly [AgentId, AgentId];
  readonly title: string;
  readonly frames: ReadonlyArray<DMWindowFrame>;
  readonly zIndex: number;
  readonly position: DMWindowPosition;
  /**
   * True when this window's thread most recently received a frame.
   * Drives the `.dmWindowFocused` shadow bump, mirroring how the
   * real advanced-desktop `AgentWindow` raises a heavier drop
   * shadow on the focused window.
   */
  readonly isFocused: boolean;
  readonly onFocus: (threadId: ThreadId) => void;
}

export function DMWindow({
  threadId,
  participants,
  title,
  frames,
  zIndex,
  position,
  isFocused,
  onFocus,
}: DMWindowProps): ReactNode {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyInnerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the bottom whenever a new frame lands so the
  // most recent message is always visible inside the window. We
  // scroll the actual body container (not the page) and only run
  // when the frame count changes; React batches updates inside the
  // reducer so this fires once per appended frame. The body uses
  // `scroll-behavior: smooth` in CSS, so this `scrollTop` assignment
  // glides the body up rather than snapping — which is the visual
  // effect the old FLIP helper was trying (and failing) to provide.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [frames.length]);

  // Re-pin the body to the bottom whenever the rows' aggregate height
  // grows BETWEEN frame appends. Three independent sources expand the
  // body's `scrollHeight` without changing `frames.length`:
  //   • `TypewriterText` reveals one char every 28ms — long messages
  //     eventually line-wrap and add a row of height.
  //   • `TerminalStream` flushes terminal lines one at a time inside
  //     tool-card frames, growing the card vertically.
  //   • The bubble phase swap (`typing` → `content`) replaces the
  //     typing dots with the typewriter and changes the bubble's
  //     natural height.
  // A single `ResizeObserver` on the inner content wrapper catches
  // all three without needing per-component callbacks. Observing
  // `.dmBody` directly wouldn't work — its layout size is clamped by
  // `flex: 1` + `max-height`, so its border-box never changes when
  // descendants grow (only `scrollHeight` does, which RO doesn't
  // report). The inner wrapper is a real flex container (see
  // `.dmBodyInner` in the stylesheet) so it has a layout box that
  // grows with its children, which is what RO fires on.
  useEffect(() => {
    const body = bodyRef.current;
    const inner = bodyInnerRef.current;
    if (!body || !inner) return;
    const ro = new ResizeObserver(() => {
      body.scrollTop = body.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const handleFocus = useCallback(() => {
    onFocus(threadId);
  }, [onFocus, threadId]);

  const containerStyle: CSSProperties = {
    zIndex,
    top: position.top,
    left: position.left,
    right: position.right,
    bottom: position.bottom,
    width: position.width,
    maxHeight: position.maxHeight,
  };

  const [leftAgent, rightAgent] = participants;
  const leftMeta = AGENTS[leftAgent];
  const rightMeta = AGENTS[rightAgent];

  const windowClass = `${styles.dmWindow} ${isFocused ? styles.dmWindowFocused : ""}`;

  return (
    <div
      className={windowClass}
      style={containerStyle}
      data-thread-id={threadId}
      data-testid={`dm-window-${threadId}`}
      data-focused={isFocused ? "true" : undefined}
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
            <Minus size={12} strokeWidth={2} />
          </span>
          <span className={styles.dmControl}>
            <Square size={10} strokeWidth={2} />
          </span>
          <span className={`${styles.dmControl} ${styles.dmControlClose}`}>
            <X size={12} strokeWidth={2} />
          </span>
        </div>
      </div>

      <div className={styles.dmStatus} title={title}>
        <span className={styles.dmStatusDot} />
        <span className={styles.dmStatusText}>{title}</span>
      </div>

      <div className={styles.dmBody} ref={bodyRef} aria-hidden="true">
        <div className={styles.dmBodyInner} ref={bodyInnerRef}>
          {frames.map(({ key, frame }) => (
            <DMFrameRow
              key={key}
              frame={frame}
              participants={participants}
            />
          ))}
        </div>
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
}

function DMFrameRow({
  frame,
  participants,
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
          }`}
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
          className={`${styles.dmBubble} ${styles.dmBubblePhase} ${
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

/*
 * Earlier revisions of this file shipped a `useFlipRows` (First-Last-
 * Invert-Play) helper that captured each row's `getBoundingClientRect`
 * on every render and applied a 480ms inverse-translate transition to
 * any row whose position had changed. The intent was to smoothly slide
 * existing rows up while a new row entered at the bottom — but in
 * practice it false-positived on every script advance and re-animated
 * already-settled rows, producing the visible "messages jump after a
 * message loads" jitter:
 *
 *   1. The deps array (`[visibleKeys]`) was a fresh `frames.map(f =>
 *      f.key)` array reference on every render, so React's `Object.is`
 *      deps comparison always saw it as changed and the FLIP effect
 *      ran on every `DMWindow` re-render — not only when frames were
 *      appended.
 *   2. `DMWindowManager` rebuilds `state.windows` on every `advance`,
 *      so every `DMWindow` (including ones not receiving the new
 *      frame) re-rendered on every script step and re-measured.
 *   3. `.dmWindow` carries a continuous `dmIdleDrift` 9s translateY
 *      animation, so the parent transform had drifted by 1–3px between
 *      renders — measurements taken via `getBoundingClientRect()` (a
 *      viewport-relative read that includes ancestor transforms) saw
 *      the rows in a new place even though the row's own layout was
 *      unchanged.
 *   4. The body auto-scroll-to-bottom lives in `useEffect`, which runs
 *      AFTER the FLIP's `useLayoutEffect`. So FLIP captured pre-scroll
 *      positions on render N, then on render N+1 measured POST the
 *      previous render's scroll and computed a ~rowHeight delta — and
 *      animated every existing row by that delta.
 *
 * The cleanest fix is to delete the helper. Rows are only ever
 * appended at the bottom, so their document-layout positions don't
 * actually shift when a new sibling lands; the only motion that should
 * happen is the body's scroll-to-bottom, which we now let the browser
 * animate via `scroll-behavior: smooth` on `.dmBody`. The new row
 * still gets its `dmRowEnter` keyframe; existing rows just stay put.
 */
