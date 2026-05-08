import { useCallback, useMemo, useRef } from "react";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { EmptyState } from "../EmptyState";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../SidekickItemContextMenu";
import {
  type AnnotatedSession,
  bucketizeByDate,
  deriveSessionLabel,
  type SessionRow,
} from "./session-row-utils";
import { useSessionSummaries } from "./use-session-summaries";
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
}

/**
 * Date-bucketed session list shared between the agents app's "Chats"
 * sidekick and the projects app's "Sessions" sidekick. Every session
 * the API returns is rendered immediately — sessions that don't have
 * a Haiku summary yet show as `NEW_CHAT_PLACEHOLDER` ("New chat") and
 * upgrade in place once `useSessionSummaries` finishes the
 * Haiku round-trip.
 *
 * The aura-os-server `list_project_sessions` / `list_sessions`
 * handlers filter out sessions with zero persisted events (see
 * `filter_nonempty_sessions` in
 * `apps/aura-os-server/src/handlers/agents/sessions.rs`), so a row
 * here is always navigable — clicking it always lands in a chat with
 * at least one user message.
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
}: SessionsListProps) {
  const summaries = useSessionSummaries(sessions);
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
  const explorerBuckets = useMemo(
    () =>
      buckets.map((bucket) => ({
        label: bucket.label,
        data: bucket.rows.map<ExplorerNode>(({ session, label }) => ({
          id: session.session_id,
          label,
          metadata: { type: "session" },
        })),
      })),
    [buckets],
  );
  // Stable controlled-selection array so the Explorer's `useMemo`s
  // for `selectedIds` / context value don't see a new identity on
  // every parent render (which would still be cheap, but this keeps
  // referential equality for `[selectedSessionId]` when it's
  // unchanged).
  const explorerSelectedIds = useMemo(
    () => (selectedSessionId ? [selectedSessionId] : []),
    [selectedSessionId],
  );

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
  const handleExplorerSelect = useCallback(
    (ids: string[]) => {
      const id = [...ids].reverse().find((candidate) => sessionById.has(candidate));
      if (!id) return;
      const session = sessionById.get(id);
      if (session) onSessionClick(session);
    },
    [onSessionClick, sessionById],
  );
  const handleSessionHoverTarget = useCallback(
    (target: EventTarget | null) => {
      if (!onSessionHover || !(target instanceof HTMLElement)) return;
      const row = target.closest<HTMLButtonElement>("button[id]");
      if (!row) return;
      const session = sessionById.get(row.id);
      if (!session || lastHoveredSessionIdRef.current === session.session_id) return;
      lastHoveredSessionIdRef.current = session.session_id;
      onSessionHover(session);
    },
    [onSessionHover, sessionById],
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
        onContextMenu={handleContextMenu}
        onMouseEnter={(event) => handleSessionHoverTarget(event.target)}
        onMouseOver={(event) => handleSessionHoverTarget(event.target)}
        onFocusCapture={(event) => handleSessionHoverTarget(event.target)}
      >
        {explorerBuckets.map((bucket) => (
          <section key={bucket.label} className={styles.chatsBucket}>
            <div className={styles.chatsBucketHeader}>{bucket.label}</div>
            <Explorer
              data={bucket.data}
              className={styles.sessionsExplorer}
              enableDragDrop={false}
              enableMultiSelect={false}
              selectedIds={explorerSelectedIds}
              onSelect={handleExplorerSelect}
            />
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
