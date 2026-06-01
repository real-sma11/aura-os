import { apiFetch } from "./core";
import type { SubagentState } from "../types/harness-protocol";
import type { ChatAttachment } from "../types/aura-events/payloads";
import type { SessionEvent } from "../types";
import { isSubagentState } from "../utils/subagent";

/**
 * Response from `POST /api/streams/subagents/:child_run_id/attach`.
 * `attach_id` is passed to the existing `GET /api/streams/:attach_id`
 * replay/tail endpoint (via `attachToStream`).
 */
export interface SubagentAttachResponse {
  attach_id: string;
  child_run_id: string;
}

/**
 * One row from
 * `GET /api/projects/:projectId/agents/:agentInstanceId/sessions/:sessionId/subagents`.
 * Mirrors the server `SubagentThreadDto`.
 */
export interface SubagentThreadDto {
  child_run_id: string;
  parent_tool_use_id?: string;
  subagent_type: string;
  prompt: string;
  message_id?: string;
  state?: SubagentState;
  created_at?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validateAttachResponse(value: unknown): SubagentAttachResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("Malformed subagent attach response");
  }
  const record = value as Record<string, unknown>;
  const attachId = asString(record.attach_id);
  const childRunId = asString(record.child_run_id);
  if (!attachId || !childRunId) {
    throw new Error("Subagent attach response missing attach_id / child_run_id");
  }
  return { attach_id: attachId, child_run_id: childRunId };
}

function validateThread(value: unknown): SubagentThreadDto | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const childRunId = asString(record.child_run_id);
  if (!childRunId) return null;
  const state = record.state;
  return {
    child_run_id: childRunId,
    parent_tool_use_id: asString(record.parent_tool_use_id),
    subagent_type: asString(record.subagent_type) ?? "",
    prompt: asString(record.prompt) ?? "",
    message_id: asString(record.message_id),
    state: isSubagentState(state) ? state : undefined,
    created_at: asString(record.created_at),
  };
}

export const subagentsApi = {
  /**
   * Attach to a spawned child run's live harness stream and mint the
   * resumable `attach_id` the SSE replay/tail endpoint expects.
   */
  attach: async (
    childRunId: string,
    parentToolUseId?: string,
  ): Promise<SubagentAttachResponse> => {
    const params = new URLSearchParams();
    if (parentToolUseId) params.set("parent_tool_use_id", parentToolUseId);
    const qs = params.toString();
    const raw = await apiFetch<unknown>(
      `/api/streams/subagents/${encodeURIComponent(childRunId)}/attach${
        qs ? `?${qs}` : ""
      }`,
      { method: "POST" },
    );
    return validateAttachResponse(raw);
  },

  /**
   * Deliver a follow-up user turn into a still-running subagent child
   * thread. The subagent must already be attached (a live stream
   * registered) so the server can resolve its retained harness session;
   * the resulting frames stream back over the same `attach_id` the
   * subagent thread is tailing. Rejects with a descriptive error when
   * the run has already terminated.
   */
  send: async (
    childRunId: string,
    content: string,
    attachments?: ChatAttachment[],
  ): Promise<void> => {
    await apiFetch<unknown>(
      `/api/streams/subagents/${encodeURIComponent(childRunId)}/send`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
        }),
      },
    );
  },

  /**
   * Fetch the persisted transcript for a subagent's dedicated storage
   * session. Called on a history-reopened card (keyed by the
   * `subagentSessionId` folded onto the `task` block) to render the child
   * thread after its live run has been reaped. Returns the reconstructed
   * `SessionEvent[]`, same wire shape as the top-level session-events
   * endpoints.
   */
  listSessionEvents: async (subagentSessionId: string): Promise<SessionEvent[]> =>
    apiFetch<SessionEvent[]>(
      `/api/streams/subagents/sessions/${encodeURIComponent(subagentSessionId)}/events`,
    ),

  /** List the subagent threads spawned in a chat session. */
  listSessionSubagents: async (
    projectId: string,
    agentInstanceId: string,
    sessionId: string,
  ): Promise<SubagentThreadDto[]> => {
    const raw = await apiFetch<unknown>(
      `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(
        agentInstanceId,
      )}/sessions/${encodeURIComponent(sessionId)}/subagents`,
    );
    if (!Array.isArray(raw)) return [];
    const threads: SubagentThreadDto[] = [];
    for (const item of raw) {
      const thread = validateThread(item);
      if (thread) threads.push(thread);
    }
    return threads;
  },
};
