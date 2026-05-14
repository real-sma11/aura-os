import { apiFetch } from "./core";

export interface AgentOrderPrefs {
  agents_app: string[];
  /** project_id → ordered agent_id list. Shared by Projects and Tasks surfaces. null = inherit agents_app. */
  projects_app: Record<string, string[]> | null;
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
