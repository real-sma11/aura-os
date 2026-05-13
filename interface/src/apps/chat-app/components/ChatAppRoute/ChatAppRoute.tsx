import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { ChatPanel } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { useAgents, useSuperAgent } from "../../../agents/stores";
import { useSelectedAgent } from "../../../agents/stores";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useChatAppChat } from "../../hooks/use-chat-app-chat";

/**
 * Top-level Chat app route. Resolves the user's super-agent (CEO),
 * which the agents-store auto-provisions via `api.superAgent.setup()`
 * on first fetch, then mounts the standard `ChatPanel` against it.
 *
 * - `/chat`             -> fresh canvas (next send creates a session).
 * - `/chat?session=<id>`-> opens that historical CEO session.
 *
 * Sessions back onto the super-agent + Home project, so they show up
 * in the Agents app's "Chats" sidekick and the Projects app's
 * "Sessions" list as well — by design.
 */
export function ChatAppRoute() {
  const { fetchAgents, status } = useAgents();
  const superAgent = useSuperAgent();
  const { setSelectedAgent } = useSelectedAgent();
  const { isMobileLayout } = useAuraCapabilities();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  useEffect(() => {
    fetchAgents().catch(() => {});
  }, [fetchAgents]);

  // Mirror the resolved super-agent into the shared selected-agent
  // slot so the sidekick (which reuses `AgentInfoPanel` /
  // `AgentSidekickTaskbar`) renders the CEO's profile, memory, skills,
  // etc. instead of an empty "select an agent" state.
  useEffect(() => {
    if (superAgent) {
      setSelectedAgent(superAgent.agent_id);
    }
  }, [superAgent, setSelectedAgent]);

  const sharedChatProps = useChatAppChat(superAgent?.agent_id, sessionId);

  if (!superAgent) {
    if (status === "error") {
      return (
        <PageEmptyState
          title="Couldn't load chat"
          description="Try again in a moment."
        />
      );
    }
    return (
      <PageEmptyState
        icon={<Loader2 size={32} className="animate-spin" aria-hidden />}
        title="Starting chat…"
      />
    );
  }

  const panelProps = {
    ...sharedChatProps,
    scrollToBottomOnReset: false,
  };

  return isMobileLayout ? (
    <MobileChatPanel {...panelProps} />
  ) : (
    <ChatPanel {...panelProps} />
  );
}
