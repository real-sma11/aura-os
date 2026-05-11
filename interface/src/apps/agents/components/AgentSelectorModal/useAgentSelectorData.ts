import { useState, useEffect, useCallback } from "react";
import { api } from "../../../../api/client";
import type { Agent, AgentInstance } from "../../../../shared/types";
import { useProfileStatusStore } from "../../../../stores/profile-status-store";
import { useOrgStore } from "../../../../stores/org-store";

// Sentinel used by `creating` for the "Standard Agent" row so the list
// can show its loading affordance without conflicting with a real
// `Agent.agent_id`. Real agent ids are UUIDs so this string is safely
// disjoint from the agent_id space.
export const STANDARD_AGENT_CREATING_KEY = "__standard_agent__";

interface AgentSelectorData {
  agents: Agent[];
  loading: boolean;
  creating: string | null;
  error: string;
  showEditor: boolean;
  setShowEditor: (v: boolean) => void;
  failedIcons: Set<string>;
  setFailedIcons: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleSelect: (agent: Agent) => Promise<void>;
  handleSelectStandard: () => Promise<void>;
  handleAgentSaved: (agent: Agent) => void;
  handleClose: () => void;
}

export function useAgentSelectorData(
  isOpen: boolean,
  projectId: string,
  onCreated: (instance: AgentInstance) => void,
  onClose: () => void,
): AgentSelectorData {
  const registerAgents = useProfileStatusStore((s) => s.registerAgents);
  const registerRemote = useProfileStatusStore((s) => s.registerRemoteAgents);
  const activeOrg = useOrgStore((state) => state.activeOrg);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

  const fetchAgents = useCallback(() => {
    setLoading(true);
    setError("");
    // Scope to the active org so aura-network returns the full org
    // fleet (matching `useAgentStore.fetchAgents`). Without the
    // `org_id` arg, aura-network falls back to `WHERE user_id = $1`
    // and only returns agents the current user authored, hiding
    // teammates' shared agents from the picker.
    api.agents
      .list(activeOrg?.org_id)
      .then((nextAgents) => {
        setAgents(nextAgents);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load agents"))
      .finally(() => setLoading(false));
  }, [activeOrg?.org_id]);

  useEffect(() => {
    if (isOpen) fetchAgents();
  }, [isOpen, fetchAgents]);

  useEffect(() => {
    if (agents.length === 0) return;
    registerAgents(agents.map((a) => ({ id: a.agent_id, machineType: a.machine_type })));
    const remote = agents.filter((a) => a.machine_type === "remote" && a.network_agent_id);
    if (remote.length > 0) registerRemote(remote);
  }, [agents, registerAgents, registerRemote]);

  const handleSelect = useCallback(async (agent: Agent) => {
    setCreating(agent.agent_id);
    setError("");
    try {
      const instance = await api.createAgentInstance(projectId, agent.agent_id);
      onCreated(instance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent instance");
    } finally {
      setCreating(null);
    }
  }, [projectId, onCreated]);

  // "Standard Agent" path: replaces what the project-row "+" used to do
  // inline (`api.createGeneralAgentInstance`). Selecting it spawns a
  // fresh general-purpose agent for the project — no AgentEditorModal,
  // no naming step — and routes through the same `onCreated` so the
  // sidebar/cache updates and navigation match the existing flow.
  const handleSelectStandard = useCallback(async () => {
    setCreating(STANDARD_AGENT_CREATING_KEY);
    setError("");
    try {
      const instance = await api.createGeneralAgentInstance(projectId);
      onCreated(instance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create standard agent");
    } finally {
      setCreating(null);
    }
  }, [projectId, onCreated]);

  const handleAgentSaved = useCallback(async (agent: Agent) => {
    setAgents((prev) => {
      const idx = prev.findIndex((a) => a.agent_id === agent.agent_id);
      if (idx >= 0) return prev.map((a) => (a.agent_id === agent.agent_id ? agent : a));
      return [...prev, agent];
    });
    setCreating(agent.agent_id);
    setError("");
    try {
      const instance = await api.createAgentInstance(projectId, agent.agent_id);
      onCreated(instance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Created the agent but could not add it to this project");
    } finally {
      setCreating(null);
    }
  }, [onCreated, projectId]);

  const handleClose = useCallback(() => {
    setError("");
    setCreating(null);
    setShowEditor(false);
    onClose();
  }, [onClose]);

  return {
    agents, loading, creating, error, showEditor, setShowEditor,
    failedIcons, setFailedIcons, handleSelect, handleSelectStandard,
    handleAgentSaved, handleClose,
  };
}
