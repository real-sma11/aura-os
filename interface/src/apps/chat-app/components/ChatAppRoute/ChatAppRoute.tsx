import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { ChatPanel } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { useSelectedAgent } from "../../../agents/stores";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useChatAppAgent } from "../../hooks/use-chat-app-agent";
import { useChatAppChat } from "../../hooks/use-chat-app-chat";

/**
 * Top-level Chat app route. Resolves the canonical chat agent via
 * `useChatAppAgent` (which calls the idempotent
 * `POST /api/agents/harness/setup` and caches the result for the app
 * session), then mounts the standard `ChatPanel` against it.
 *
 * - `/chat`             -> fresh canvas (next send creates a session).
 * - `/chat?session=<id>`-> opens that historical chat-agent session.
 *
 * Sessions back onto the chat agent + Home project, so they show up
 * in the Agents app's "Chats" sidekick and the Projects app's
 * "Sessions" list as well — by design.
 */
export function ChatAppRoute() {
  const { agent, status, error } = useChatAppAgent();
  const { setSelectedAgent } = useSelectedAgent();
  const { isMobileLayout } = useAuraCapabilities();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");

  // Mirror the resolved chat agent into the shared selected-agent
  // slot so the sidekick (which reuses `AgentInfoPanel` /
  // `AgentSidekickTaskbar`) renders the agent's profile, memory,
  // skills, etc. instead of an empty "select an agent" state.
  useEffect(() => {
    if (agent) {
      setSelectedAgent(agent.agent_id);
    }
  }, [agent, setSelectedAgent]);

  const sharedChatProps = useChatAppChat(agent?.agent_id, sessionId);

  if (!agent) {
    if (status === "error") {
      return (
        <PageEmptyState
          title="Couldn't start chat"
          description={error ?? "Try again in a moment."}
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
