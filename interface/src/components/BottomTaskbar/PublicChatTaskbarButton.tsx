import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { TaskbarIconButton, TASKBAR_ICON_SIZE } from "../AppNavRail";
import { isChatPathname } from "../../utils/last-app-path";

const PUBLIC_CHAT_PATH = "/chat";

/**
 * Public-mode bottom-left Chat affordance. Behaves as a toggle:
 *
 *   - On any non-chat public page it opens `/chat`.
 *   - While already on `/chat` it navigates BACK to the last non-chat
 *     location the visitor was on (falling back to `/` when there is
 *     none, e.g. a direct deep-link into `/chat`).
 *
 * The previous location is tracked in a ref that only updates on
 * non-chat paths, so it always holds "where you just were" before
 * opening chat. The ref is read inside the click handler (never during
 * render) and navigation goes through `useNavigate`, mirroring the
 * authed Desktop button's previous-path toggle in `BottomTaskbar`.
 */
export function PublicChatTaskbarButton(): React.ReactElement {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const onChat = isChatPathname(pathname);

  const lastNonChatPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isChatPathname(pathname)) {
      lastNonChatPathRef.current = `${pathname}${search}`;
    }
  }, [pathname, search]);

  const handleClick = (): void => {
    if (onChat) {
      navigate(lastNonChatPathRef.current ?? "/");
    } else {
      navigate(PUBLIC_CHAT_PATH);
    }
  };

  return (
    <TaskbarIconButton
      icon={<MessageSquare size={TASKBAR_ICON_SIZE} />}
      selected={onChat}
      title={onChat ? "Back" : "Chat"}
      aria-label={onChat ? "Back to previous page" : "Chat"}
      onClick={handleClick}
    />
  );
}
