/**
 * Route element shared by `/agents/:agentId` and
 * `/projects/:projectId/agents/:agentInstanceId`.
 *
 * The agent chat is no longer rendered here. It lives in the shell-level
 * `ConversationSurfaceHost`, a single persistent surface keyed by conversation
 * lane so switching between the Agents and Projects apps on the same
 * agent/session never remounts the chat. This element therefore renders
 * nothing — its only job is to make the route match so the host (which derives
 * the target from the URL) takes over while the app's `MainPanel` wraps an
 * empty outlet.
 */
export function AgentChatRoute(): null {
  return null;
}
