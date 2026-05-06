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

interface SessionsListProps {
  sessions: AnnotatedSession[];
  loading: boolean;
  selectedSessionId: string | null;
  onSessionClick: (session: AnnotatedSession) => void;
  onDeleteSession?: (session: AnnotatedSession) => void;
  /** Optional substring to filter rows by their resolved label. */
  searchQuery?: string;
}

/**
 * Date-bucketed session list shared between the agents app's "Chats"
 * sidekick and the projects app's "Sessions" sidekick. Untitled
 * sessions stay invisible — `useSessionSummaries` is still attempting
 * to summarize them, so the row appears as soon as the backend returns
 * a non-empty summary. Truly empty sessions never get a title and
 * therefore never show up, matching the ChatGPT-style behavior.
 */
export function SessionsList({
  sessions,
  loading,
  selectedSessionId,
  onSessionClick,
  onDeleteSession,
  searchQuery,
}: SessionsListProps) {
  const summaries = useSessionSummaries(sessions);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const titledRows = useMemo<SessionRow[]>(() => {
    const out: SessionRow[] = [];
    const needle = searchQuery?.trim().toLowerCase() ?? "";
    for (const session of sessions) {
      const label = deriveSessionLabel(session, summaries[session.session_id]);
      if (!label) continue;
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
      onDeleteSession?.(target);
    },
    [menu, closeMenu, onDeleteSession],
  );

  if (loading && sessions.length === 0) {
    return <div className={styles.tabEmptyState}>Loading sessions...</div>;
  }

  if (titledRows.length === 0) {
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <>
      <div className={styles.chatsList} onContextMenu={handleContextMenu}>
        {buckets.map((bucket) => (
          <section key={bucket.label} className={styles.chatsBucket}>
            <div className={styles.chatsBucketHeader}>{bucket.label}</div>
            {bucket.rows.map(({ session, label }) => {
              const isSelected = session.session_id === selectedSessionId;
              return (
                <button
                  key={session.session_id}
                  type="button"
                  id={session.session_id}
                  className={`${styles.chatsRow}${isSelected ? ` ${styles.chatsRowSelected}` : ""}`}
                  data-session-id={session.session_id}
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
