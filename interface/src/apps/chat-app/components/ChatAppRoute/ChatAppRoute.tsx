import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { ChatPanel } from "../../../chat/components/ChatPanel";
import { MobileChatPanel } from "../../../../mobile/chat/MobileChatPanel";
import { useAgents, useSelectedAgent } from "../../../agents/stores";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useSessionsListStore } from "../../../../stores/sessions-list-store";
import type { Agent } from "../../../../shared/types";
import { useChatAppAgent } from "../../hooks/use-chat-app-agent";
import { useChatAppChat } from "../../hooks/use-chat-app-chat";
import { useChatAppSessions } from "../../hooks/use-chat-app-sessions";

/**
 * Top-level Chat app route. Resolves the canonical chat agent via
 * `useChatAppAgent` (which calls the idempotent
 * `POST /api/agents/harness/setup` and caches the result for the app
 * session) for the empty-canvas case, and falls through to the
 * URL-provided / session-derived agent for cross-agent conversations
 * surfaced from the left panel.
 *
 * - `/chat`
 *     -> fresh canvas (next send creates a session on the CEO agent).
 * - `/chat?session=<id>` (legacy)
 *     -> looks the session up in the merged cross-agent list and
 *        opens it against its owning agent (derived via
 *        `bindingsByAgent`).
 * - `/chat?agent=<aid>&project=<pid>&instance=<iid>&session=<sid>`
 *     -> the canonical form written by `ChatAppLeftPanel`; mounts the
 *        right `ChatPanel` before the merged session list has loaded.
 *
 * The sidekick (mounted via `ChatApp.SidekickPanel = AgentInfoPanel`)
 * reads its agent from `useSelectedAgent()`, so the effective agent is
 * mirrored into that slot here — the sidekick automatically re-renders
 * the right profile / chats / skills / memory tabs for whichever
 * agent owns the active conversation.
 */
export function ChatAppRoute() {
  const { agent: chatAgent, status, error } = useChatAppAgent();
  const { agents } = useAgents();
  const { setSelectedAgent } = useSelectedAgent();
  const { isMobileLayout } = useAuraCapabilities();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session");
  const agentIdParam = searchParams.get("agent");
  const { sessions } = useChatAppSessions(agents);

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) map.set(a.agent_id, a);
    return map;
  }, [agents]);

  const bindingsByAgent = useSessionsListStore((s) => s.bindingsByAgent);

  // `project_agent_id` -> owning `Agent` map, sourced from each
  // agent's server-authoritative bindings (`bindingsByAgent` is
  // populated by `loadAgentSessions` and includes the auto-created
  // Home project, which `useProjectsListStore` may not surface for
  // remote agents). Used to resolve the legacy `/chat?session=<id>`
  // form into the right agent. Memoized so unrelated store updates
  // (e.g. `sessionsBySurface` writes for other agents) don't churn
  // every render here.
  const agentByInstance = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) {
      const bindings = bindingsByAgent[a.agent_id];
      if (!bindings) continue;
      for (const b of bindings) map.set(b.project_agent_id, a);
    }
    return map;
  }, [agents, bindingsByAgent]);

  // Effective agent resolution order:
  //   1. `?agent=<id>` (written by `ChatAppLeftPanel`) — wins so the
  //      chat panel mounts the right agent before the merged session
  //      list has loaded.
  //   2. `?session=<id>` (legacy / shared-link form) — look the
  //      session up in the merged cross-agent list and use the agent
  //      that owns its `_agentInstanceId` per `bindingsByAgent`.
  //   3. Fallback to the canonical CEO chat agent so `/chat` (no
  //      params) keeps the fresh-canvas it always did.
  const effectiveAgent = useMemo<Agent | null>(() => {
    if (agentIdParam) {
      const fromUrl = agentById.get(agentIdParam);
      if (fromUrl) return fromUrl;
    }
    if (sessionId) {
      const session = sessions.find((s) => s.session_id === sessionId);
      if (session) {
        const owner = agentByInstance.get(session._agentInstanceId);
        if (owner) return owner;
      }
    }
    return chatAgent;
  }, [agentIdParam, agentById, sessionId, sessions, agentByInstance, chatAgent]);

  // Mirror the effective agent into the shared selected-agent slot so
  // the sidekick (`AgentInfoPanel` / `AgentSidekickTaskbar`) renders
  // the right agent's profile, memory, skills, etc. for every
  // selected conversation.
  useEffect(() => {
    if (effectiveAgent) {
      setSelectedAgent(effectiveAgent.agent_id);
    }
  }, [effectiveAgent, setSelectedAgent]);

  const sharedChatProps = useChatAppChat(
    effectiveAgent?.agent_id,
    sessionId,
  );

  if (!effectiveAgent) {
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
