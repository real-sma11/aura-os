import { apiFetch } from "./core";

export interface AgentOrderPrefs {
  agents_app: string[];
  /** project_id → ordered agent_id list. null = no per-project customisation (inherit agents_app). */
  projects_app: Record<string, string[]> | null;
  tasks_app: Record<string, string[]> | null;
}

export const preferencesApi = {
  getAgentOrder: (): Promise<AgentOrderPrefs> =>
    apiFetch("/api/preferences/agent-order"),

  putAgentOrder: (prefs: AgentOrderPrefs): Promise<AgentOrderPrefs> =>
    apiFetch("/api/preferences/agent-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }),
};
