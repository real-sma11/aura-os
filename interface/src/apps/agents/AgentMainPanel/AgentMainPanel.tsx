import { type ReactNode } from "react";

/**
 * Agents-app `MainPanel`. The agent chat now renders in the shell-level
 * `ConversationSurfaceHost` (a persistent, conversation-target-keyed surface),
 * so this is a pure passthrough for the route outlet. Terminal targeting and
 * agent-selection syncing — previously done here off `useParams` that this
 * shell-level wrapper never actually received — now live in the host, driven
 * by the location-parsed target.
 */
export function AgentMainPanel({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
