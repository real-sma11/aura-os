import type {
  AgentInstanceId,
  ProjectId,
  SessionId,
  SessionEventId,
  TaskId,
} from "../ids";
import type { SessionStatus } from "../enums";

export interface Session {
  session_id: SessionId;
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  active_task_id: TaskId | null;
  tasks_worked: TaskId[];
  context_usage_estimate: number;
  total_input_tokens: number;
  total_output_tokens: number;
  summary_of_previous_context: string;
  status: SessionStatus;
  user_id?: string;
  model?: string;
  started_at: string;
  ended_at: string | null;
}

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string; source_url?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string;
      is_error?: boolean }
  | { type: "task_ref"; task_id: string; title: string }
  | { type: "spec_ref"; spec_id: string; title: string };

export interface SessionEvent {
  event_id: SessionEventId;
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  role: "user" | "assistant" | "system";
  content: string;
  content_blocks?: ChatContentBlock[];
  thinking?: string;
  thinking_duration_ms?: number;
  created_at: string;
  /**
   * `true` when this row is a server-reconstructed snapshot of an
   * assistant turn that has been started but not yet terminated by an
   * `assistant_message_end`. The chat panel uses this flag to keep
   * `streamingAgentInstanceId` set after a mid-turn page refresh, and
   * the sidekick uses it to rebuild `pending-*` spec/task placeholders
   * from the partial `content_blocks` it carries.
   */
  in_flight?: boolean;
  /**
   * Set on `user_message` rows that were *injected by another agent*
   * rather than typed by the human user. Two paths populate it
   * server-side:
   *   1. **A → B inbound** — when agent A invokes the harness
   *      `send_to_agent` tool against B, the harness's
   *      `cross_agent_hook::deliver_message` POSTs a `user_message`
   *      into B's session carrying `from_agent_id: A's UUID`.
   *   2. **B → A async reply** — when B's turn finishes, the
   *      server-side `spawn_cross_agent_reply_callback` POSTs B's
   *      reply back into A's session as another `user_message`,
   *      stamped with `from_agent_id: B's UUID`.
   *
   * `MessageBubble` reads this and labels the row "↩ from
   * <agent name>" instead of styling it indistinguishably from a
   * real user prompt — without it, Barret's reply showed up in
   * A's chat as a duplicate of A's own input. `undefined` on every
   * regular human-typed user message and on assistant rows.
   */
  from_agent_id?: string;
}
