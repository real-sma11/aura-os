import { EventType } from "../shared/types/aura-events";
import type { AuraEventOfType } from "../shared/types/aura-events";
import { useEventStore } from "./event-store/index";
import {
  agentHistoryKey,
  projectChatHistoryKey,
  sessionHistoryKey,
  useChatHistoryStore,
} from "./chat-history-store";
import { createEventSubscriptionGroup } from "./event-subscription-group";

/* ------------------------------------------------------------------ */
/*  App-scoped chat-history cache invalidator                          */
/*                                                                     */
/*  The mounted-panel `useChatHistorySync` hook only force-refetches   */
/*  history when its panel is currently visible. That is the right     */
/*  shape for the live in-panel update, but it leaves a hole for       */
/*  cross-agent writes (`send_to_agent` from agent A into agent B):    */
/*  if the user is sitting on agent A when B's `user_message` /        */
/*  `assistant_message_end` lands on the WS bus, B's panel has no      */
/*  live subscriber and the event is dropped on the floor. When the    */
/*  user later navigates to B, `fetchHistory` short-circuits on the    */
/*  cached entry (TTL `HISTORY_TTL_MS = 30s` in `chat-history-store`)  */
/*  and serves stale data — so the new message is invisible until a    */
/*  manual refresh. Sidebar prefetching makes the cache "warm" on      */
/*  almost every navigation, so this fires on virtually every          */
/*  cross-agent send.                                                  */
/*                                                                     */
/*  This bootstrap installs a SECOND, app-global subscriber that       */
/*  marks the chat-history-store cache stale for every history key     */
/*  the inbound event could possibly route to, regardless of which     */
/*  panel (if any) is currently mounted. The next `fetchHistory` for   */
/*  any of those keys will then bypass the TTL short-circuit and       */
/*  re-fetch from the server. Cheap when nothing matches:              */
/*  `invalidateHistory` is a no-op when the entry is absent.           */
/*                                                                     */
/*  Wire shape (pinned in                                              */
/*  `apps/aura-os-server/src/handlers/agents/chat/event_bus.rs` and    */
/*  parsed by `parseAuraEvent`):                                       */
/*    `{ session_id, project_id, project_agent_id, agent_id }`         */
/*  Each present id maps to a corresponding history key shape.         */
/* ------------------------------------------------------------------ */

type ChatLifecycleEvent =
  | AuraEventOfType<typeof EventType.UserMessage>
  | AuraEventOfType<typeof EventType.AssistantMessageEnd>;

/**
 * Compute the set of `chat-history-store` keys the inbound chat
 * lifecycle event could route to. Exported so the unit tests can
 * pin the mapping without driving the full subscription group.
 *
 * Each present id stamps its corresponding key shape:
 *   - `agent_id` (org-level)            → `agentHistoryKey(agent_id)`
 *   - `project_id` + `project_agent_id` → `projectChatHistoryKey(...)`
 *   - + `session_id`                    → `sessionHistoryKey(...)`
 *
 * Empty / null / blank ids are skipped silently (the parser fills
 * absent fields with `""` for `session_id` / `agent_id` / `project_id`
 * and `null` for `project_agent_id`, so the trim guard catches both).
 */
export function chatHistoryKeysFromEvent(event: ChatLifecycleEvent): string[] {
  const keys: string[] = [];
  const sessionId = stripBlank(event.session_id);
  const projectId = stripBlank(event.project_id);
  const projectAgentId = stripBlank(event.project_agent_id ?? undefined);
  const agentId = stripBlank(event.agent_id);

  if (agentId) {
    keys.push(agentHistoryKey(agentId));
  }
  if (projectId && projectAgentId) {
    keys.push(projectChatHistoryKey(projectId, projectAgentId));
    if (sessionId) {
      keys.push(sessionHistoryKey(projectId, projectAgentId, sessionId));
    }
  }
  return keys;
}

function stripBlank(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function invalidateChatHistoryForEvent(event: ChatLifecycleEvent): void {
  const keys = chatHistoryKeysFromEvent(event);
  if (keys.length === 0) return;
  const store = useChatHistoryStore.getState();
  for (const key of keys) {
    store.invalidateHistory(key);
  }
}

const chatHistoryInvalidatorGroup = createEventSubscriptionGroup(
  () => useEventStore.getState().subscribe,
  (subscribe) => [
    subscribe(EventType.UserMessage, invalidateChatHistoryForEvent),
    subscribe(EventType.AssistantMessageEnd, invalidateChatHistoryForEvent),
  ],
);

/**
 * Installs the app-global chat-history cache invalidation listeners.
 * Safe to call multiple times — re-invocations no-op until
 * `teardownChatHistoryInvalidator` is used (test-only).
 */
export function bootstrapChatHistoryInvalidator(): void {
  chatHistoryInvalidatorGroup.bootstrap();
}

/** Test-only: undo the bootstrap so tests can re-install a fresh set. */
export function teardownChatHistoryInvalidator(): void {
  chatHistoryInvalidatorGroup.teardown();
}
