import { type ReactNode } from "react";

// The shell (`AuraShell` / `MobileShell`) provides a persistent
// `ResponsiveMainLane` around every app's `MainPanel`, and the agent chat now
// renders in the shell-level `ConversationSurfaceHost` keyed by conversation
// lane. This is therefore a pure passthrough: it returns its children
// verbatim. Terminal targeting (previously attempted here off `useParams`,
// which this above-the-route wrapper never received) is owned by the host.
export function SharedMainPanel({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
