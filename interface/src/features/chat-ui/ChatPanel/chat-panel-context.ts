import { createContext, useContext } from "react";

/**
 * Identifies the owning `ChatPanel` to descendants rendered deep inside
 * the message list (e.g. a `task` tool card). A subagent card uses this
 * to open the panel's slide-over sub-pane targeted at the correct
 * surface without prop-threading a stream key through every layer
 * (`ChatMessageList` -> `MessageBubble` -> block registry).
 *
 * Carries the panel's PARENT stream key (its stable identity), which is
 * also the key the `subagent-pane-store` is partitioned by — so opening
 * a card always addresses the panel it lives in.
 */
export const ChatPanelStreamContext = createContext<string | undefined>(undefined);

/** Read the owning panel's parent stream key, if any. */
export function useChatPanelStreamKey(): string | undefined {
  return useContext(ChatPanelStreamContext);
}
