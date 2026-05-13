import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import { useAgentStore } from "../../agents/stores";
import type { Agent } from "../../../shared/types";

type ChatAppAgentStatus = "loading" | "ready" | "error";

interface ChatAppAgentSlice {
  agent: Agent | null;
  status: ChatAppAgentStatus;
  error: string | null;
  retry: () => void;
}

interface CachedAgentState {
  agent: Agent | null;
  status: ChatAppAgentStatus;
  error: string | null;
  inflight: Promise<void> | null;
}

// Module-scope cache so multiple components mounting `useChatAppAgent`
// (route + left panel) share a single setup round-trip and the same
// resolved agent id within an app session.
const cache: CachedAgentState = {
  agent: null,
  status: "loading",
  error: null,
  inflight: null,
};
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

function ensureSetup(): Promise<void> {
  if (cache.inflight) return cache.inflight;
  if (cache.agent) return Promise.resolve();

  cache.status = "loading";
  cache.error = null;
  notify();

  cache.inflight = api.superAgent
    .setup()
    .then(({ agent }) => {
      cache.agent = agent;
      cache.status = "ready";
      cache.error = null;
      // Mirror into the shared agent store so the sidekick (Profile,
      // Memory, Skills, Chats tabs) and any other surface that reads
      // `useAgents()` finds the chat agent immediately, even on first
      // visit before `fetchAgents()` has populated the list.
      const store = useAgentStore.getState();
      const present = store.agents.some((a) => a.agent_id === agent.agent_id);
      if (present) {
        store.patchAgent(agent);
      } else {
        useAgentStore.setState((s) => ({ agents: [...s.agents, agent] }));
      }
    })
    .catch((err: unknown) => {
      cache.agent = null;
      cache.status = "error";
      cache.error = err instanceof Error ? err.message : "Couldn't start chat";
    })
    .finally(() => {
      cache.inflight = null;
      notify();
    });

  return cache.inflight;
}

/**
 * Resolves the chat agent the Chat app talks to. Calls
 * `api.superAgent.setup()` once per app session — the endpoint is
 * idempotent and creates the canonical CEO + Home binding when
 * missing — and returns the resulting agent regardless of whether it
 * still matches the strict `isSuperAgent()` (name+role) shape. That
 * matters because users can rename their CEO; the strict check would
 * leave `useSuperAgent()` returning `null` forever and the Chat app
 * stuck on "Starting chat…".
 */
export function useChatAppAgent(): ChatAppAgentSlice {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    subscribers.add(fn);
    void ensureSetup();
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  return {
    agent: cache.agent,
    status: cache.status,
    error: cache.error,
    retry: () => {
      // Force a fresh attempt after an error.
      if (cache.status === "error") {
        cache.agent = null;
        cache.status = "loading";
        cache.error = null;
        notify();
        void ensureSetup();
      }
    },
  };
}
