import { parseConversationRoute } from "../../apps/agents/hooks/use-conversation-route";
import { useProjectsListStore } from "../../stores/projects-list-store";
import {
  getLastAgent,
  getLastProject,
  getLastStandaloneAgentId,
} from "../../utils/storage";

export type AppSwitchTargetId = "agents" | "projects";

/**
 * Resolve where the Agents <-> Projects switch should land.
 *
 * When the user is already in an agent chat, we map to the EQUIVALENT
 * conversation lane in the other app so `ConversationSurfaceHost` sees the
 * same lane key and keeps the chat mounted (instant, no remount). Computed
 * synchronously from routing + store state in the click handler — no effects.
 *
 * Falls back to each app's last-visited surface when there is no current
 * conversation to carry across.
 */
export function resolveAppSwitchPath(
  targetId: AppSwitchTargetId,
  pathname: string,
  search: string,
): string {
  const route = parseConversationRoute(pathname, search);

  if (targetId === "projects") {
    return resolveProjectsPath(route);
  }
  return resolveAgentsPath(route);
}

function resolveProjectsPath(
  route: ReturnType<typeof parseConversationRoute>,
): string {
  // Already on a project chat lane: carry the (project, instance, session).
  if (route.projectId && route.agentInstanceId) {
    return projectChatPath(route.projectId, route.agentInstanceId, route.sessionId);
  }
  // On the agents shell with the project/instance mirrors: carry them over.
  if (route.queryProjectId && route.queryInstanceId) {
    return projectChatPath(
      route.queryProjectId,
      route.queryInstanceId,
      route.sessionId,
    );
  }
  // Fallback: last-visited project surface.
  const projectId = getLastProject();
  if (projectId) {
    const agentInstanceId = getLastAgent(projectId);
    if (agentInstanceId) return `/projects/${projectId}/agents/${agentInstanceId}`;
    return `/projects/${projectId}/agent`;
  }
  return "/projects";
}

function resolveAgentsPath(
  route: ReturnType<typeof parseConversationRoute>,
): string {
  // On a project chat lane: find the underlying agent id and carry the lane
  // across as the agents-shell deep-link triple.
  if (route.projectId && route.agentInstanceId) {
    const agentId = findAgentIdForInstance(route.projectId, route.agentInstanceId);
    if (agentId) {
      return agentsShellPath(
        agentId,
        route.projectId,
        route.agentInstanceId,
        route.sessionId,
      );
    }
  }
  // Fallback: last-visited standalone agent.
  const lastId = getLastStandaloneAgentId();
  if (lastId) return `/agents/${lastId}`;
  return "/agents";
}

function projectChatPath(
  projectId: string,
  agentInstanceId: string,
  sessionId: string | null,
): string {
  const base = `/projects/${projectId}/agents/${agentInstanceId}`;
  return sessionId ? `${base}?session=${sessionId}` : base;
}

function agentsShellPath(
  agentId: string,
  projectId: string,
  agentInstanceId: string,
  sessionId: string | null,
): string {
  const params = new URLSearchParams();
  params.set("project", projectId);
  params.set("instance", agentInstanceId);
  if (sessionId) params.set("session", sessionId);
  return `/agents/${agentId}?${params.toString()}`;
}

function findAgentIdForInstance(
  projectId: string,
  agentInstanceId: string,
): string | undefined {
  const instances = useProjectsListStore.getState().agentsByProject[projectId];
  return instances?.find((i) => i.agent_instance_id === agentInstanceId)?.agent_id;
}
