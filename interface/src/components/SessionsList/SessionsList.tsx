import { useCallback, useMemo } from "react";
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

// Optimistic "New chat" placeholder rows carry an extra `_pending: true`
// flag added by `useSessionsListStore.setPendingNewChat`. The flag never
// rides along on real, server-persisted sessions, so its presence is the
// single test we need to short-circuit row interactions (delete, context
// menu) and apply the muted style. Kept inline so the SessionsList file
// stays self-contained — the type declaration lives in
// `sessions-list-store` next to the action that produces it.
function isPendingSession(session: AnnotatedSession): boolean {
  return (session as { _pending?: boolean })._pending === true;
}

interface SessionsListProps {
  sessions: AnnotatedSession[];
  loading: boolean;
  selectedSessionId: string | null;
  onSessionClick: (session: AnnotatedSession) => void;
  onDeleteSession?: (session: AnnotatedSession) => void;
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
 * at least one user message. The lazy chat-input "+" doesn't create
 * a session until the first send, but `create_new_chat_session` runs
 * before `persist_user_message`, so first-turn races used to leave
 * orphan zero-event rows in the sidekick. The backend filter is the
 * fix; this comment is a backstop for anyone reintroducing a
 * "render every row" assumption client-side.
 */
export function SessionsList({
  sessions,
  loading,
  selectedSessionId,
  onSessionClick,
  onDeleteSession,
  searchQuery,
  deleteError,
  onDismissError,
}: SessionsListProps) {
  const summaries = useSessionSummaries(sessions);

  // The optimistic "New chat" placeholder row carries `_pending: true`
  // (set by `useSessionsListStore.setPendingNewChat` from the chat-input
  // "+" handler). It is rendered like any other row but never wired to
  // delete or context-menu actions — there's nothing on the server yet
  // to delete, and the row is auto-replaced on `SessionReady`.
  const sessionById = useMemo(
    () => new Map(sessions.filter((s) => !isPendingSession(s)).map((s) => [s.session_id, s])),
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
      if (isPendingSession(target)) return;
      onDeleteSession?.(target);
    },
    [menu, closeMenu, onDeleteSession],
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
      <div className={styles.chatsList} onContextMenu={handleContextMenu}>
        {buckets.map((bucket) => (
          <section key={bucket.label} className={styles.chatsBucket}>
            <div className={styles.chatsBucketHeader}>{bucket.label}</div>
            {bucket.rows.map(({ session, label }) => {
              const isSelected = session.session_id === selectedSessionId;
              const isPending = isPendingSession(session);
              const className = [
                styles.chatsRow,
                isSelected ? styles.chatsRowSelected : "",
                isPending ? styles.chatsRowPending : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={session.session_id}
                  type="button"
                  id={session.session_id}
                  className={className}
                  data-session-id={session.session_id}
                  data-pending={isPending ? "true" : undefined}
                  aria-current={isSelected ? "page" : undefined}
                  onClick={() => onSessionClick(session)}
                >
                  {label}
                </button>
              );
            })}
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
