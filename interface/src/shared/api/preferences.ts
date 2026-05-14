import { apiFetch } from "./core";

export interface AgentOrderPrefs {
  agents_app: string[];
  projects_app: string[] | null;
  tasks_app: string[] | null;
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
