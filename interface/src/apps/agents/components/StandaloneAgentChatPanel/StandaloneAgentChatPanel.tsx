import { useEffect } from "react";
import { useStandaloneAgentChat } from "../../../../hooks/use-standalone-agent-chat";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { ChatPanel, type ChatPanelProps } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { LAST_AGENT_ID_KEY } from "../../stores";

interface StandaloneAgentChatPanelProps {
  agentId: string;
  /** `?session=` from the URL when the user navigated in via a session row. */
  sessionId: string | null;
  /** Set when the user clicked `+` for a fresh canvas before bindings
   *  resolved; the panel suppresses history fetches until SessionReady
   *  pins a real session id. */
  freshCanvasPending?: boolean;
  initialCreateHandoff: boolean;
  onInitialHandoffReady?: () => void;
}

/**
 * Standalone-agent chat for the genuine "agent has no project bindings"
 * case (and the floating desktop window). All real chat wiring lives in
 * `useStandaloneAgentChat`; this component only mounts the appropriate
 * desktop / mobile panel and mirrors the agent id into the legacy
 * `LAST_AGENT_ID_KEY` localStorage key for the agent rail.
 */
export function StandaloneAgentChatPanel({
  agentId,
  sessionId,
  freshCanvasPending = false,
  initialCreateHandoff,
  onInitialHandoffReady,
}: StandaloneAgentChatPanelProps) {
  const sharedChatProps = useStandaloneAgentChat(agentId, sessionId, {
    freshCanvasPending,
  });
  const { isMobileLayout } = useAuraCapabilities();

  useEffect(() => {
    try {
      localStorage.setItem(LAST_AGENT_ID_KEY, agentId);
    } catch {
      /* ignore */
    }
  }, [agentId]);

  const panelProps: ChatPanelProps = {
    ...sharedChatProps,
    initialHandoff: initialCreateHandoff ? "create-agent" : undefined,
    onInitialHandoffReady,
    scrollToBottomOnReset: false,
  };

  return isMobileLayout ? <MobileChatPanel {...panelProps} /> : <ChatPanel {...panelProps} />;
}
