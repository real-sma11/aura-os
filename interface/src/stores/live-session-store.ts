import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/**
 * Per-surface "current live session" pin used by the chat panel to
 * scope the visible transcript to a single session after the user
 * starts a new chat (via the chat input "+" button or the
 * RotateCcw "reset session" affordance).
 *
 * Background:
 *  - Project chat normally uses `historyKey: project:${projectId}:${agentInstanceId}`
 *    and `getEvents`, which returns history aggregated across **all**
 *    sessions for that agent instance (`load_project_session_history`
 *    in `apps/aura-os-server/src/handlers/agents/chat/events.rs`).
 *  - That's why a server-side session reset alone doesn't blank the
 *    visible transcript — old sessions still show up on remount.
 *
 * Lifecycle:
 *  1. `markPending(surfaceKey)` is called when the user clicks "+"
 *     or RotateCcw. The previous pin (if any) is cleared so the
 *     panel falls back to aggregated history *until* the next
 *     `SessionReady` arrives.
 *  2. The chat stream handler intercepts the next `SessionReady`
 *     event for that surface and calls `pin(surfaceKey, sessionId)`.
 *  3. With a pin set, `AgentChatView` switches `historyKey` /
 *     `fetchFn` to a session-scoped pair (`live-session:` prefix) but
 *     keeps `onSend` enabled — distinct from the read-only `?session=`
 *     archived view.
 *
 * Hard reload clears the pin (Zustand non-persisted), so a fresh tab
 * returns to the aggregated-history default. We can layer
 * `sessionStorage` persistence on top later if we want stickier
 * per-tab behavior.
 *
 * Surface key shapes:
 *  - Project chat: `${projectId}:${agentInstanceId}`
 *  - Standalone agent chat: `agent:${agentId}`
 */
interface LiveSessionState {
  pinned: Record<string, string>;
  pending: Record<string, true>;
  markPending: (surfaceKey: string) => void;
  pin: (surfaceKey: string, sessionId: string) => void;
  clear: (surfaceKey: string) => void;
}

export const useLiveSessionStore = create<LiveSessionState>((set) => ({
  pinned: {},
  pending: {},

  markPending: (surfaceKey) => {
    set((s) => {
      const nextPinned = { ...s.pinned };
      delete nextPinned[surfaceKey];
      return {
        pinned: nextPinned,
        pending: { ...s.pending, [surfaceKey]: true },
      };
    });
  },

  pin: (surfaceKey, sessionId) => {
    set((s) => {
      const nextPending = { ...s.pending };
      delete nextPending[surfaceKey];
      return {
        pinned: { ...s.pinned, [surfaceKey]: sessionId },
        pending: nextPending,
      };
    });
  },

  clear: (surfaceKey) => {
    set((s) => {
      if (!(surfaceKey in s.pinned) && !(surfaceKey in s.pending)) return s;
      const nextPinned = { ...s.pinned };
      const nextPending = { ...s.pending };
      delete nextPinned[surfaceKey];
      delete nextPending[surfaceKey];
      return { pinned: nextPinned, pending: nextPending };
    });
  },
}));

export function projectSurfaceKey(projectId: string, agentInstanceId: string): string {
  return `${projectId}:${agentInstanceId}`;
}

export function agentSurfaceKey(agentId: string): string {
  return `agent:${agentId}`;
}

/**
 * Hook variant that returns the pinned session id (or null) for the
 * given surface key, with shallow-equality so consumers don't
 * re-render on unrelated surface updates.
 */
export function useLiveSessionId(surfaceKey: string | undefined): string | null {
  return useLiveSessionStore(
    useShallow((s) => (surfaceKey ? s.pinned[surfaceKey] ?? null : null)),
  );
}
