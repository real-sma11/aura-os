import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
 * Wall-clock for the chrome's open / close animations. Exported so
 * `DMWindowManager` can chain its lifecycle timers against the exact
 * durations the stylesheet uses — bump the keyframe duration in
 * `DMWindow.module.css` and these constants in lockstep, otherwise
 * the manager either advances the script before the chrome is done
 * animating (open) or unmounts a window mid-collapse (close).
 *
 * `WINDOW_OPEN_MS` also acts as a gate inside this file: rows aren't
 * mounted until the chrome has fully scaled in, so the typing
 * indicator + typewriter timers don't start ticking against an
 * invisible/scaling bubble.
 */
export const WINDOW_OPEN_MS = 500;
export const WINDOW_CLOSE_MS = 360;

/**
 * One floating DM window mounted by `DMWindowManager`. Renders the
 * MSN/ICQ-style chrome (titlebar with the recipient's name +
 * fake window controls, message body) and projects
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
 *
 * Drag / resize. The chrome mirrors the live `AgentWindow` so the
 * interaction does too: the titlebar drags the window, eight 6–12px
 * handles around the edges resize it (n/s/e/w + corners), and both
 * gestures use global `pointermove`/`pointerup` listeners scoped to
 * the captured `pointerId` so a fast drag that leaves the window
 * doesn't desync. Before any interaction the window paints from the
 * authored `top/left/right/bottom/width/maxHeight` strings in
 * `THREAD_POSITIONS`; on the first pointerdown we measure the
 * authored layout against the parent (`.windowManager`) and convert
 * it to a pixel `{ x, y, width, height }` rect that subsequent moves
 * mutate. The window also stamps `data-user-positioned="true"` once
 * it commits to pixels so the CSS can stop the idle drift animation
 * (a continuous `translateY` would fight the `left/top` updates).
 *
 * Per-window minimums are intentionally smaller than the
 * `AgentWindow`'s 320×240 (those windows host the full `ChatPanel`).
 * These mock panes are compact decorative surfaces, so we floor at
 * 180×140 — enough to keep at least one bubble + the titlebar
 * legible without letting the user collapse the window into a strip.
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
  /**
   * The manager flips this true once the script has finished its
   * loop and the cascade is collapsing back to empty. While set,
   * the window paints with `data-state="closing"` so the stylesheet
   * runs the `dmWindowCollapse` keyframe instead of the open pop /
   * idle drift, and we also stop mounting body rows so the close
   * animation runs against a stable layout.
   */
  readonly isClosing: boolean;
  /**
   * Per-window delay before the close animation starts, in ms. The
   * manager sorts windows by descending z-index and assigns each a
   * `index * WINDOW_CLOSE_STAGGER_MS` delay so the most-recently
   * focused window collapses first and the cascade tears down in
   * reverse focus order.
   */
  readonly closeDelayMs: number;
}

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface UserRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const MIN_W = 180;
const MIN_H = 140;

export function DMWindow({
  threadId,
  participants,
  frames,
  zIndex,
  position,
  isFocused,
  onFocus,
  isClosing,
  closeDelayMs,
}: DMWindowProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyInnerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Two-phase open: the chrome (titlebar + empty body wrapper)
   * mounts immediately and animates from
   * `scale(0.4)` to `scale(1)` via `dmWindowExpand` (see
   * `DMWindow.module.css`). Body rows are gated behind this flag
   * so the first `DMFrameRow` only mounts AFTER the chrome has
   * finished animating, which means its `typingMs` timer + the
   * `TypewriterText` interval don't start ticking against an
   * actively-scaling parent (which would visibly chew through the
   * first few hundred ms of the message before the window finished
   * settling). Inter-frame timing in the script is ~1.5-3.7s
   * between adjacent frames in the same thread, so a one-time
   * `WINDOW_OPEN_MS` (500ms) delay on the first row never causes
   * the manager's queue to back up — the second frame still lands
   * after the first has fully typed.
   */
  const [isOpen, setIsOpen] = useState<boolean>(false);
  useEffect(() => {
    const handle = setTimeout(() => {
      setIsOpen(true);
    }, WINDOW_OPEN_MS);
    return () => clearTimeout(handle);
  }, []);

  /**
   * Null until the user first interacts (drag or resize). On the
   * first pointerdown we read the window's current rendered rect
   * relative to the parent container and commit it to state so the
   * authored `top/left/right/bottom/width/maxHeight` anchors are
   * collapsed into a single `{ x, y, width, height }` baseline that
   * pointer moves can mutate without anchor ambiguity.
   */
  const [userRect, setUserRect] = useState<UserRect | null>(null);
  // Mirror of `userRect` for pointer-move closures: setState batching
  // would otherwise leave the closure reading a stale baseline after
  // the first move flushes. We seed `dragRef`/`resizeRef` from
  // `rectRef.current` instead.
  const rectRef = useRef<UserRect | null>(null);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    winX: number;
    winY: number;
  } | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    winW: number;
    winH: number;
  } | null>(null);
  const resizePointerIdRef = useRef<number | null>(null);

  // Auto-scroll to the bottom whenever a new frame lands so the
  // most recent message is always visible inside the window. We
  // scroll the actual body container (not the page) and only run
  // when the frame count changes; React batches updates inside the
  // reducer so this fires once per appended frame. The scroll is
  // instant (CSS no longer sets `scroll-behavior: smooth` on
  // `.dmBody`) because the row's own `dmRowEnter` keyframe handles
  // the "new message pops in at the bottom" feel — having the body
  // glide on top of that animation just produced a softer-but-also-
  // visible shift.
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
  //
  // The pin is instant (no `scroll-behavior: smooth` on `.dmBody`)
  // because a smooth scroll here was retargeting on every line wrap
  // during streaming; once the typewriter stopped, the still-in-
  // flight smooth animation kept gliding to its last target,
  // showing the entire body shift ~10-17px the instant a message
  // resolved (visible as the "the chat slides down slightly when
  // the message is done" the homepage hero shipped with). Instant
  // scrolling snaps to the bottom on each wrap, which produces no
  // settling shift and reads as the standard chat-tail behavior.
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

  /**
   * Snapshot the window's current rect against its parent container
   * so the first drag/resize move has a `{ x, y, width, height }`
   * baseline to mutate. We can't lean on `position.left`/`.top`
   * directly because two threads anchor from `right`/`bottom` and a
   * third uses percentages; reading the rendered rect collapses all
   * three anchor styles into the same pixel space.
   */
  const captureBaseline = useCallback((): UserRect | null => {
    if (rectRef.current) return rectRef.current;
    const node = containerRef.current;
    const parent = node?.parentElement;
    if (!node || !parent) return null;
    const nodeRect = node.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const rect: UserRect = {
      x: nodeRect.left - parentRect.left,
      y: nodeRect.top - parentRect.top,
      width: nodeRect.width,
      height: nodeRect.height,
    };
    rectRef.current = rect;
    setUserRect(rect);
    return rect;
  }, []);

  const parentSize = useCallback((): { width: number; height: number } | null => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return null;
    const r = parent.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }, []);

  /**
   * Install ONE long-lived `pointermove` + `pointerup` +
   * `pointercancel` listener trio per window for the lifetime of the
   * component. The handlers fan out to drag vs. resize based on
   * which interaction ref is populated. Two reasons for this shape
   * over the per-interaction attach/detach pattern the live
   * `AgentWindow` uses:
   *   1. It avoids a `useCallback` declaration cycle (move → up →
   *      detach → move) that would otherwise trip
   *      `react-hooks/immutability` ("accessed before declared"),
   *      since `detach` has to reference the same function
   *      identities passed to `addEventListener`.
   *   2. The handlers no-op when no drag/resize is in flight (the
   *      first `if (!ref.current) return` line), so the cost of
   *      keeping them attached is a few-ns identity check per
   *      pointermove. Cheaper than churning listeners on/off.
   * The single cleanup runs when the manager resets every ~45s (and
   * unmounts every window), so a drag that's still in flight at
   * reset time can't leak listeners onto `window`.
   */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        if (dragPointerIdRef.current !== null && e.pointerId !== dragPointerIdRef.current) return;
        const base = rectRef.current;
        if (!base) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        const bounds = parentSize();
        let nextX = d.winX + dx;
        let nextY = d.winY + dy;
        if (bounds) {
          // Clamp so the window can't be dragged outside its
          // parent. We allow `0` on the leading edges and
          // `parent - size` on the trailing edges, so the entire
          // window stays within the frame.
          const maxX = Math.max(0, bounds.width - base.width);
          const maxY = Math.max(0, bounds.height - base.height);
          nextX = Math.min(maxX, Math.max(0, nextX));
          nextY = Math.min(maxY, Math.max(0, nextY));
        }
        const nextRect: UserRect = { ...base, x: nextX, y: nextY };
        rectRef.current = nextRect;
        setUserRect(nextRect);
        return;
      }

      const r = resizeRef.current;
      if (r) {
        if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;
        const bounds = parentSize();

        let newX = r.winX;
        let newY = r.winY;
        let newW = r.winW;
        let newH = r.winH;

        if (r.dir.includes("e")) newW = r.winW + dx;
        if (r.dir.includes("w")) {
          newW = r.winW - dx;
          if (newW >= MIN_W) newX = r.winX + dx;
          else newW = MIN_W;
        }
        if (r.dir.includes("s")) newH = r.winH + dy;
        if (r.dir.includes("n")) {
          newH = r.winH - dy;
          const candidateY = r.winY + dy;
          if (newH >= MIN_H && candidateY >= 0) newY = candidateY;
          else if (candidateY < 0) {
            newH = r.winH + r.winY;
            newY = 0;
          } else newH = MIN_H;
        }

        newW = Math.max(MIN_W, newW);
        newH = Math.max(MIN_H, newH);
        newX = Math.max(0, newX);
        newY = Math.max(0, newY);

        if (bounds) {
          // Clamp the trailing edge so a SE drag past the parent's
          // right/bottom edge doesn't push the window's border off
          // the frame. We only need to clamp the size (not x/y)
          // because the `w`/`n` branches above already commit
          // `newX`/`newY` from the user's drag delta.
          newW = Math.min(newW, bounds.width - newX);
          newH = Math.min(newH, bounds.height - newY);
          newW = Math.max(MIN_W, newW);
          newH = Math.max(MIN_H, newH);
        }

        const nextRect: UserRect = { x: newX, y: newY, width: newW, height: newH };
        rectRef.current = nextRect;
        setUserRect(nextRect);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (dragRef.current) {
        if (dragPointerIdRef.current !== null && e.pointerId !== dragPointerIdRef.current) return;
        dragRef.current = null;
        dragPointerIdRef.current = null;
        return;
      }
      if (resizeRef.current) {
        if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
        resizeRef.current = null;
        resizePointerIdRef.current = null;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragRef.current = null;
      dragPointerIdRef.current = null;
      resizeRef.current = null;
      resizePointerIdRef.current = null;
    };
  }, [parentSize]);

  const handleTitleBarPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // The fake min/max/close controls are `<span>` rather than
      // `<button>` (they're decorative), so we gate on the CSS
      // module class instead of `closest("button")` like the live
      // `AgentWindow` does — otherwise a pointerdown on one of the
      // controls would start dragging the window.
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.dmControl}`)) return;
      e.preventDefault();
      e.stopPropagation();
      onFocus(threadId);
      const base = captureBaseline();
      if (!base) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: base.x,
        winY: base.y,
      };
      dragPointerIdRef.current = e.pointerId;
    },
    [captureBaseline, onFocus, threadId],
  );

  const handleResizePointerDown = useCallback(
    (dir: ResizeDir) => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(threadId);
      const base = captureBaseline();
      if (!base) return;
      resizeRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        winX: base.x,
        winY: base.y,
        winW: base.width,
        winH: base.height,
      };
      resizePointerIdRef.current = e.pointerId;
    },
    [captureBaseline, onFocus, threadId],
  );

  const handleFocus = useCallback(() => {
    onFocus(threadId);
  }, [onFocus, threadId]);

  // Before the first user interaction we honour the authored anchors
  // (`top/left/right/bottom/width/maxHeight`) so the empty-state
  // cascade reads exactly as before. After the first drag/resize
  // we switch to pixel `left/top/width/height` from `userRect` —
  // the conversion happens in `captureBaseline` on the first
  // pointerdown.
  const baseStyle: CSSProperties = userRect
    ? {
        zIndex,
        left: userRect.x,
        top: userRect.y,
        width: userRect.width,
        height: userRect.height,
      }
    : {
        zIndex,
        top: position.top,
        left: position.left,
        right: position.right,
        bottom: position.bottom,
        width: position.width,
        maxHeight: position.maxHeight,
      };

  // When the manager is closing the cascade we override `animation-
  // delay` inline so each window's `dmWindowCollapse` starts at its
  // assigned stagger offset. We only set the delay when actually
  // closing — leaving it on during open/idle would shift the
  // `dmIdleDrift` start time and feel unsynchronised between
  // adjacent windows.
  const containerStyle: CSSProperties = isClosing
    ? { ...baseStyle, animationDelay: `${closeDelayMs}ms` }
    : baseStyle;

  const [, titleAgent] = participants;
  const titleMeta = AGENTS[titleAgent];

  const windowClass = `${styles.dmWindow} ${isFocused ? styles.dmWindowFocused : ""}`;

  const resizeHandles: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  const resizeClassMap: Record<ResizeDir, string> = {
    n: styles.resizeN,
    s: styles.resizeS,
    e: styles.resizeE,
    w: styles.resizeW,
    ne: styles.resizeNE,
    nw: styles.resizeNW,
    se: styles.resizeSE,
    sw: styles.resizeSW,
  };

  return (
    <div
      ref={containerRef}
      className={windowClass}
      style={containerStyle}
      data-thread-id={threadId}
      data-testid={`dm-window-${threadId}`}
      data-focused={isFocused ? "true" : undefined}
      data-user-positioned={userRect ? "true" : undefined}
      data-state={isClosing ? "closing" : isOpen ? "open" : "opening"}
      onMouseDown={handleFocus}
    >
      <div
        className={styles.dmTitlebar}
        data-testid={`dm-window-${threadId}-titlebar`}
        onPointerDown={handleTitleBarPointerDown}
      >
        <div className={styles.dmTitleParticipants}>
          <ParticipantDot agentId={titleAgent} />
          <span className={styles.dmTitleName}>{titleMeta.name}</span>
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

      <div className={styles.dmBody} ref={bodyRef} aria-hidden="true">
        <div className={styles.dmBodyInner} ref={bodyInnerRef}>
          {isOpen && !isClosing
            ? frames.map(({ key, frame }) => (
                <DMFrameRow
                  key={key}
                  frame={frame}
                  participants={participants}
                />
              ))
            : null}
        </div>
      </div>

      {resizeHandles.map((dir) => (
        <div
          key={dir}
          className={resizeClassMap[dir]}
          data-testid={`dm-window-${threadId}-resize-${dir}`}
          onPointerDown={handleResizePointerDown(dir)}
        />
      ))}
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
