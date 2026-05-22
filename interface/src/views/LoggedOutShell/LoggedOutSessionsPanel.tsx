import { useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { LoggedOutPanelFooter } from "./LoggedOutPanelFooter";
import styles from "./LoggedOutShell.module.css";

interface LoggedOutSessionsPanelProps {
  /**
   * Free-text filter applied to the rendered sessions. Owned by
   * `LoggedOutShell` (the search input lives in the shared sidebar
   * header above this panel) so the filter follows the same input
   * the user types into.
   */
  searchQuery?: string;
}

/**
 * Left rail of the logged-out shell. Lists public sessions (read from
 * `usePublicChatStore`) and renders the marketing footer at the
 * bottom. Intentionally does NOT reuse `components/SessionsList` —
 * that component is shaped around server-fetched `AnnotatedSession`
 * rows (project info, summaries, date bucketing) and adapting it to
 * a purely client-side public store would force a bag of fake fields.
 * A lightweight row list is the right tool for ≤ N sessions here.
 *
 * The "+" new-chat affordance and the inline "Chats" header used to
 * live here, but both moved up to `LoggedOutShell` so the shared
 * sidebar search row hosts the action and the search bar itself
 * stands in for the section title.
 */
export function LoggedOutSessionsPanel({
  searchQuery = "",
}: LoggedOutSessionsPanelProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSessionId = searchParams.get("session");

  const sessions = usePublicChatStore((s) => s.sessions);
  const sessionOrder = usePublicChatStore((s) => s.sessionOrder);
  const deleteSession = usePublicChatStore((s) => s.deleteSession);

  const orderedSessions = useMemo(
    () =>
      sessionOrder
        .map((id) => sessions[id])
        .filter((s): s is NonNullable<typeof s> => Boolean(s)),
    [sessionOrder, sessions],
  );

  const filteredSessions = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return orderedSessions;
    return orderedSessions.filter((session) =>
      session.title.toLowerCase().includes(needle),
    );
  }, [orderedSessions, searchQuery]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/?session=${id}`);
    },
    [navigate],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteSession(id);
      if (id !== activeSessionId) return;
      // The deleted row was the active session, so the URL still
      // points at it. Hop to the most recent remaining session
      // (sessionOrder is newest-first) instead of falling back to
      // `/`, which would otherwise re-trigger `LoggedOutChatView`'s
      // auto-create-on-mount and immediately spawn a fresh "New chat"
      // row in place of the one the user just removed — making the
      // delete look like it failed. If nothing remains, hand off to
      // `/` so the auto-create lands the visitor on a usable surface.
      const nextActive = sessionOrder.find((existing) => existing !== id);
      navigate(nextActive ? `/?session=${nextActive}` : "/");
    },
    [activeSessionId, deleteSession, navigate, sessionOrder],
  );

  const isFiltering = searchQuery.trim().length > 0;
  const emptyMessage = isFiltering
    ? "No matching chats"
    : "No conversations yet";

  return (
    <>
      <div className={styles.sessionsBody}>
        {filteredSessions.length === 0 ? (
          <div className={styles.emptyHint}>{emptyMessage}</div>
        ) : (
          filteredSessions.map((session) => (
            // Two sibling <button>s in a flex row instead of a delete
            // button nested inside a select button. Nesting interactive
            // content inside a <button> is invalid HTML and was the
            // root cause of unreliable click delivery on the X icon.
            <div
              key={session.id}
              className={`${styles.sessionRow} ${
                session.id === activeSessionId ? styles.sessionRowActive : ""
              }`}
            >
              <button
                type="button"
                className={styles.sessionRowSelect}
                onClick={() => handleSelect(session.id)}
              >
                <span className={styles.sessionRowTitle}>{session.title}</span>
              </button>
              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => handleDelete(session.id)}
                aria-label={`Delete chat "${session.title}"`}
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>
      <LoggedOutPanelFooter />
    </>
  );
}
