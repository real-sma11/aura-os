import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EmptyState } from "../EmptyState";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../SidekickItemContextMenu";
import { isOptimisticSessionId } from "../../stores/sessions-list-store";
import {
  type AnnotatedSession,
  bucketizeByDate,
  deriveSessionLabel,
  type SessionRow,
} from "./session-row-utils";
import { useSessionSummaries } from "./use-session-summaries";
import { useIsSessionStreaming } from "../../hooks/use-session-streaming";
import styles from "./SessionsList.module.css";

interface SessionsListProps {
  sessions: AnnotatedSession[];
  loading: boolean;
  selectedSessionId: string | null;
  onSessionClick: (session: AnnotatedSession) => void;
  onDeleteSession?: (session: AnnotatedSession) => void;
  /**
   * Optional hover hook — fired on `onMouseEnter` of each row so the
   * caller can pre-warm the destination chat-history-store entry for
   * the hovered session. When the chat-history-store has the entry
   * `"ready"` at click time, `AgentChatPanel`'s `historyResolved`
   * is `true` on first render and `ChatPanel`'s cold-load reveal gate
   * stays disarmed — no `.messageContentHidden` flicker on session
   * navigation.
   */
  onSessionHover?: (session: AnnotatedSession) => void;
  /** Optional substring to filter rows by their resolved label. */
  searchQuery?: string;
  /**
   * Inline failure-banner copy for the most recent delete attempt.
   * `null`/`undefined` hides the banner. Pair with `onDismissError`
   * so the banner can be cleared after the user reads it. The agents
   * `ChatsTab` and the projects `SessionList` both read this from
   * `useSessionsDeleteError(surfaceKey)` so a 500 from
   * `DELETE /api/projects/.../sessions/...` surfaces in the UI
   * instead of vanishing into `console.error`.
   */
  deleteError?: string | null;
  onDismissError?: () => void;
  /**
   * Optional right-aligned content rendered per row. When provided this
   * replaces the default project-name suffix (used by the chat-app's
   * left panel to show the session's agent avatar on the right side of
   * each row). Returning `null`/`undefined` falls back to the default
   * behavior for that single row.
   */
  renderRowSuffix?: (session: AnnotatedSession) => ReactNode;
  /**
   * Per-session stream-lane key resolver. Mirrors `useStreamCore`'s
   * deps shape so the per-row streaming indicator subscribes to the
   * exact lane the chat panel writes to:
   *
   *   - Project chat (`useChatStream`, default): the row's own
   *     `(_projectId, _agentInstanceId, session_id)` triple.
   *   - Standalone-agent chat (`useAgentChatStream`, chat-app left
   *     panel): `(agentId, session_id)` — callers resolve the
   *     session's `agentId` first (e.g. via `bindingsByAgent`).
   *
   * Returning an empty string disables the indicator for that row
   * (the lookup hits the empty `entries[""]` slot, which is never
   * streaming). Passing `undefined` for the whole prop falls back to
   * the project-keyed default, which matches the agents-app
   * `ChatsTab` (each row maps to a project-chat lane) and the
   * projects-app `SessionList`. Phase 4 tests assert against the
   * same key shape via the exported `keyForProjectSession` /
   * `keyForAgentSession` helpers.
   */
  streamKeyForSession?: (session: AnnotatedSession) => string;
}

interface SessionRowButtonProps {
  session: AnnotatedSession;
  label: string;
  isSelected: boolean;
  suffix: ReactNode;
  onClick: (session: AnnotatedSession) => void;
  onHover: (session: AnnotatedSession) => void;
  /**
   * Visibility callback for the IntersectionObserver wired up in
   * `SessionsList`. Fires once per intersection-state change and is
   * the gate the lazy `/summarize` backfill in `useSessionSummaries`
   * uses to decide whether to fetch a Haiku title for an untitled
   * row. Off-screen rows never trigger an LLM call until they
   * scroll in.
   */
  onVisibilityChange?: (sessionId: string, visible: boolean) => void;
  streamKeyForSession?: (session: AnnotatedSession) => string;
}

/**
 * Per-row component so each row owns its own
 * `useIsSessionStreaming(session)` subscription. Hoisting the selector
 * out to the parent would re-render every row whenever any session's
 * `isStreaming` flips; subscribing per-row keeps the parent's render
 * cost flat and isolates re-renders to the rows whose lane actually
 * changed.
 */
function SessionRowButton({
  session,
  label,
  isSelected,
  suffix,
  onClick,
  onHover,
  onVisibilityChange,
  streamKeyForSession,
}: SessionRowButtonProps) {
  const isStreaming = useIsSessionStreaming(session, streamKeyForSession);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Visibility tracking for lazy summary backfill. We notify the
  // parent on intersection-state changes so `useSessionSummaries`
  // only fires `/summarize` for rows the user actually sees. The
  // observer is created per-row (not shared) because the parent
  // doesn't render a stable scroll container ref through here, and
  // the cost of N tiny observers is negligible compared to the N
  // Haiku LLM calls we're avoiding. Skip entirely in environments
  // without `IntersectionObserver` (very old browsers, jsdom test
  // shims) — the gate is a perf optimization, not correctness, so
  // falling back to "summarize on mount" matches legacy behavior.
  useEffect(() => {
    if (!onVisibilityChange) return;
    if (typeof IntersectionObserver === "undefined") {
      onVisibilityChange(session.session_id, true);
      return;
    }
    const target = buttonRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          onVisibilityChange(session.session_id, entry.isIntersecting);
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [onVisibilityChange, session.session_id]);

  return (
    <button
      id={session.session_id}
      ref={buttonRef}
      type="button"
      role="treeitem"
      aria-selected={isSelected}
      aria-current={isSelected ? "page" : undefined}
      className={`${styles.sessionRow}${isSelected ? ` ${styles.sessionRowSelected}` : ""}`}
      onClick={() => onClick(session)}
      onMouseEnter={() => onHover(session)}
      onFocus={() => onHover(session)}
    >
      {isStreaming && (
        <span
          className={styles.streamingDot}
          aria-label="Streaming"
          role="status"
        />
      )}
      <span className={styles.sessionLabel}>{label}</span>
      {suffix && <span className={styles.sessionSuffix}>{suffix}</span>}
    </button>
  );
}

/**
 * Date-bucketed session list shared between the agents app's "Chats"
 * sidekick, the projects app's "Sessions" sidekick, and the chat app's
 * left panel. Every session the API returns is rendered immediately —
 * sessions that don't have a Haiku summary yet show as
 * `NEW_CHAT_PLACEHOLDER` ("New chat") and upgrade in place once
 * `useSessionSummaries` finishes the Haiku round-trip.
 *
 * Empty zero-event sessions are filtered out by aura-storage itself
 * (the `idx_sessions_pa_recent` / `idx_sessions_project_recent`
 * partial indexes from migration 0014, both keyed on
 * `event_count > 0`). aura-os-server is a straight pass-through, so
 * a row here is always navigable — clicking it always lands in a
 * chat with at least one user message.
 *
 * Rendering uses plain `<button>` rows (not the ZUI `Explorer`) so
 * selection state is owned by a single parent-controlled
 * `effectiveSelectedSessionId` across every date bucket. Each
 * per-bucket `Explorer` previously kept its own context / focus state
 * which made it possible for rows in different time-period sections to
 * read as simultaneously highlighted; collapsing to one selection
 * surface eliminates that.
 */
export function SessionsList({
  sessions,
  loading,
  selectedSessionId,
  onSessionClick,
  onDeleteSession,
  onSessionHover,
  searchQuery,
  deleteError,
  onDismissError,
  renderRowSuffix,
  streamKeyForSession,
}: SessionsListProps) {
  // Track which rows are currently scrolled into view so the lazy
  // /summarize backfill in `useSessionSummaries` only fires for rows
  // the user can actually see. Without this gate, opening the
  // sidekick on an account with many legacy untitled sessions would
  // synchronously fire one Haiku LLM call per session — each loading
  // the full event transcript — even for rows the user never scrolls
  // to. Single shared `Set` flipped via the `onVisibilityChange`
  // callback wired into each `SessionRowButton`.
  const [visibleSessionIds, setVisibleSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const handleVisibilityChange = useCallback(
    (sessionId: string, visible: boolean) => {
      setVisibleSessionIds((prev) => {
        if (visible) {
          if (prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.add(sessionId);
          return next;
        }
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    },
    [],
  );

  const summaries = useSessionSummaries(sessions, visibleSessionIds);
  const lastHoveredSessionIdRef = useRef<string | null>(null);

  // Live-update of the row label when the backend's on-send title
  // generator (apps/aura-os-server/src/handlers/agents/sessions.rs
  // `generate_session_title`) lands a ChatGPT-style title for a
  // brand-new session is wired globally in
  // `stores/event-store/engine-event-handlers.ts`
  // `handleSessionSummaryUpdated`, not in a React effect here. Doing
  // it globally means the title is captured even if no `SessionsList`
  // is currently mounted (e.g. the user sent the message in the
  // chat panel without the sidekick open) — otherwise the user
  // would have to refresh the app to see the title.

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const titledRows = useMemo<SessionRow[]>(() => {
    const out: SessionRow[] = [];
    const needle = searchQuery?.trim().toLowerCase() ?? "";
    for (const session of sessions) {
      const label = deriveSessionLabel(session, summaries[session.session_id]);
      if (needle && !label.toLowerCase().includes(needle)) continue;
      out.push({ session, label });
    }
    return out;
  }, [sessions, summaries, searchQuery]);

  const buckets = useMemo(() => bucketizeByDate(titledRows), [titledRows]);
  // Check if sessions span multiple projects — only show the project
  // prefix when there's more than one to avoid noise in the common case.
  const hasMultipleProjects = useMemo(() => {
    const projectIds = new Set(sessions.map((s) => s._projectId));
    return projectIds.size > 1;
  }, [sessions]);

  // Highlight the row the user is actively in even when the URL hasn't
  // settled yet:
  //
  //   1. `?session=<id>` set: the URL is the source of truth.
  //   2. `?session=` empty + an optimistic row exists: pre-SessionReady
  //      "+ New chat" window. Highlight the placeholder so the user
  //      sees which chat their first send will land in.
  //   3. `?session=` empty + no optimistic row: post-`replaceSessionId`,
  //      pre-`setSearchParams` window. The row was just renamed from
  //      `optimistic:<uuid>` to the server-assigned UUID, but the
  //      router state hasn't propagated through `useSearchParams`
  //      yet. Without a fallback, the just-created row visibly
  //      appears with its summary but reads as unselected for the
  //      gap (and *persistently* in cases where the URL update was
  //      dropped — back/forward stack, suspended tab, etc.). Falling
  //      back to the newest row in the list keeps the selection on
  //      the just-created session, which sorted to the top because
  //      its `started_at` was stamped at insert time. `titledRows`
  //      is already in `sortSessionsDesc` order from
  //      `loadAgentSessions` / `loadProjectSessions` so `[0]` is the
  //      newest.
  const effectiveSelectedSessionId = useMemo(() => {
    if (selectedSessionId) return selectedSessionId;
    const optimistic = titledRows.find(({ session }) =>
      isOptimisticSessionId(session.session_id),
    );
    if (optimistic) return optimistic.session.session_id;
    return titledRows[0]?.session.session_id ?? null;
  }, [selectedSessionId, titledRows]);

  const resolveMenuTarget = useCallback(
    (nodeId: string): AnnotatedSession | null => sessionById.get(nodeId) ?? null,
    [sessionById],
  );
  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu<AnnotatedSession>({
      resolveItem: resolveMenuTarget,
    });

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || actionId !== "delete") return;
      onDeleteSession?.(target);
    },
    [menu, closeMenu, onDeleteSession],
  );

  const handleRowMouseEnter = useCallback(
    (session: AnnotatedSession) => {
      if (!onSessionHover) return;
      if (lastHoveredSessionIdRef.current === session.session_id) return;
      lastHoveredSessionIdRef.current = session.session_id;
      onSessionHover(session);
    },
    [onSessionHover],
  );

  const renderRow = useCallback(
    ({ session, label }: SessionRow) => {
      const isSelected =
        effectiveSelectedSessionId === session.session_id;
      const customSuffix = renderRowSuffix?.(session) ?? null;
      const defaultSuffix =
        hasMultipleProjects && session._projectName ? (
          <span className={styles.sessionProject}>{session._projectName}</span>
        ) : null;
      const suffix = customSuffix !== null ? customSuffix : defaultSuffix;

      return (
        <SessionRowButton
          key={session.session_id}
          session={session}
          label={label}
          isSelected={isSelected}
          suffix={suffix}
          onClick={onSessionClick}
          onHover={handleRowMouseEnter}
          onVisibilityChange={handleVisibilityChange}
          streamKeyForSession={streamKeyForSession}
        />
      );
    },
    [
      effectiveSelectedSessionId,
      handleRowMouseEnter,
      handleVisibilityChange,
      hasMultipleProjects,
      onSessionClick,
      renderRowSuffix,
      streamKeyForSession,
    ],
  );

  const errorBanner = deleteError ? (
    <div className={styles.errorBanner} role="alert">
      <span className={styles.errorBannerMessage}>{deleteError}</span>
      {onDismissError && (
        <button
          type="button"
          className={styles.errorBannerDismiss}
          onClick={onDismissError}
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  ) : null;

  if (loading && sessions.length === 0) {
    return (
      <>
        {errorBanner}
        <div className={styles.tabEmptyState}>Loading sessions...</div>
      </>
    );
  }

  if (titledRows.length === 0) {
    return (
      <>
        {errorBanner}
        <EmptyState>No sessions yet</EmptyState>
      </>
    );
  }

  return (
    <>
      {errorBanner}
      <div
        className={styles.chatsList}
        role="tree"
        onContextMenu={handleContextMenu}
      >
        {buckets.map((bucket) => (
          <section key={bucket.label} className={styles.chatsBucket}>
            <div className={styles.chatsBucketHeader}>{bucket.label}</div>
            <div className={styles.chatsBucketRows}>
              {bucket.rows.map((row) => renderRow(row))}
            </div>
          </section>
        ))}
      </div>
      {menu && onDeleteSession && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
          actions={["delete"]}
        />
      )}
    </>
  );
}
