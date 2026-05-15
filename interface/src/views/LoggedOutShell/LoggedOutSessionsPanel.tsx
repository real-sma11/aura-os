import { useCallback, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { LoggedOutPanelFooter } from "./LoggedOutPanelFooter";
import styles from "./LoggedOutShell.module.css";

/**
 * Left rail of the logged-out shell. Lists public sessions (read from
 * `usePublicChatStore`), exposes a "+" affordance that mints a fresh
 * session id and routes to `/?session=<id>`, and mounts the marketing
 * footer at the bottom. Intentionally does NOT reuse
 * `components/SessionsList` — that component is shaped around
 * server-fetched `AnnotatedSession` rows (project info, summaries,
 * date bucketing) and adapting it to a purely client-side public
 * store would force a bag of fake fields. A lightweight row list is
 * the right tool for ≤ N sessions here.
 */
export function LoggedOutSessionsPanel() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSessionId = searchParams.get("session");

  const sessions = usePublicChatStore((s) => s.sessions);
  const sessionOrder = usePublicChatStore((s) => s.sessionOrder);
  const createSession = usePublicChatStore((s) => s.createSession);
  const deleteSession = usePublicChatStore((s) => s.deleteSession);

  const orderedSessions = useMemo(
    () =>
      sessionOrder
        .map((id) => sessions[id])
        .filter((s): s is NonNullable<typeof s> => Boolean(s)),
    [sessionOrder, sessions],
  );

  const handleNewChat = useCallback(() => {
    const id = createSession();
    navigate(`/?session=${id}`);
  }, [createSession, navigate]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/?session=${id}`);
    },
    [navigate],
  );

  const handleDelete = useCallback(
    (id: string, ev: React.MouseEvent) => {
      ev.stopPropagation();
      deleteSession(id);
      if (id === activeSessionId) {
        navigate("/");
      }
    },
    [activeSessionId, deleteSession, navigate],
  );

  return (
    <>
      <div className={styles.sessionsHeader}>
        <span>Chats</span>
        <button
          type="button"
          className={styles.newChatButton}
          onClick={handleNewChat}
          aria-label="New chat"
          title="New chat"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className={styles.sessionsBody}>
        {orderedSessions.length === 0 ? (
          <div className={styles.emptyHint}>No conversations yet</div>
        ) : (
          orderedSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`${styles.sessionRow} ${
                session.id === activeSessionId ? styles.sessionRowActive : ""
              }`}
              onClick={() => handleSelect(session.id)}
            >
              <span className={styles.sessionRowTitle}>{session.title}</span>
              <span
                role="button"
                tabIndex={0}
                className={styles.deleteButton}
                onClick={(ev) => handleDelete(session.id, ev)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    deleteSession(session.id);
                  }
                }}
                aria-label={`Delete chat "${session.title}"`}
              >
                <X size={14} />
              </span>
            </button>
          ))
        )}
      </div>
      <LoggedOutPanelFooter />
    </>
  );
}
