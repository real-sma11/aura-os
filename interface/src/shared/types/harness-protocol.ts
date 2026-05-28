/**
 * Auto-generated from `aura-protocol` Rust crate via ts-rs.
 *
 * Regenerate with: `npm run codegen:protocol` (from `interface/`)
 *
 * DO NOT EDIT BY HAND — changes will be overwritten.
 */

// ============================================================================
// Installed Tool Types
// ============================================================================

export type ToolAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "api_key"; header: string; key: string }
  | { type: "headers"; headers: Record<string, string> };

export interface InstalledTool {
  name: string;
  description: string;
  input_schema: unknown;
  endpoint: string;
  auth?: ToolAuth;
  timeout_ms?: number | null;
  namespace?: string | null;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Inbound Messages (Client → Server)
// ============================================================================

export interface ConversationMessage {
  role: string;
  content: string;
}

/**
 * Phase A canonical wire shape for `POST /v1/run`. Replaces the
 * previous `SessionInit` first-frame contract on `/stream`.
 *
 * Mirror of `aura_protocol::RuntimeRequest` in Rust.
 */
export interface RuntimeRequest {
  type: RuntimeRequestType;
  agent_identity: AgentIdentity;
  model: ModelSelection;
  workspace: WorkspaceLocation;
  project?: ProjectContext | null;
  agent_permissions: unknown;
  tool_permissions?: unknown | null;
  agent_capabilities: AgentCapabilities;
  auth_jwt?: string | null;
  user_id: string;
}

export type RuntimeRequestType =
  | { kind: "chat"; params: { conversation_messages: ConversationMessage[] } }
  | { kind: "dev_loop"; params: Record<string, never> }
  | {
      kind: "task_run";
      params: {
        task_id: string;
        prior_failure?: string | null;
        work_log: string[];
      };
    };

export interface AgentIdentity {
  template_id?: string | null;
  partition_id?: string | null;
  persona?: AgentPersona | null;
  skills: string[];
  system_prompt?: string | null;
}

export interface AgentPersona {
  name: string;
  role: string;
  personality: string;
}

export interface ModelSelection {
  id?: string | null;
  max_tokens?: number | null;
  max_turns?: number | null;
  temperature?: number | null;
  provider_overrides?: unknown | null;
}

export interface WorkspaceLocation {
  workspace?: string | null;
  project_path?: string | null;
  git_repo_url?: string | null;
  git_branch?: string | null;
}

export interface ProjectContext {
  project_id: string;
  project_info?: unknown | null;
  aura_org_id?: string | null;
  aura_session_id?: string | null;
  aura_agent_id?: string | null;
}

export interface AgentCapabilities {
  installed_tools: InstalledTool[];
  installed_integrations: unknown[];
  intent_classifier?: unknown | null;
}

export interface RuntimeRunResponse {
  run_id: string;
  event_stream_url: string;
}

export interface MessageAttachment {
  type: "image" | "text";
  media_type: string;
  data: string;
  name?: string;
}

export interface UserMessage {
  content: string;
  tool_hints?: string[] | null;
  attachments?: MessageAttachment[] | null;
}

export interface ApprovalResponse {
  tool_use_id: string;
  approved: boolean;
}

/**
 * Phase A: the harness no longer accepts a `session_init` first WS
 * frame — sessions are created via `POST /v1/run` (body:
 * [`RuntimeRequest`]) and the client then opens `WS /stream/:run_id`,
 * which immediately emits `SessionReady` as the first server-side
 * frame.
 */
export type InboundMessage =
  | ({ type: "user_message" } & UserMessage)
  | { type: "cancel" }
  | ({ type: "approval_response" } & ApprovalResponse);

// ============================================================================
// Outbound Messages (Server → Client)
// ============================================================================

export interface ToolInfo {
  name: string;
  description: string;
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface SessionReady {
  session_id: string;
  tools: ToolInfo[];
  skills: SkillInfo[];
}

export interface AssistantMessageStart {
  message_id: string;
}

export interface TextDelta {
  text: string;
}

export interface ThinkingDelta {
  thinking: string;
}

export interface ToolUseStart {
  id: string;
  name: string;
}

export interface ToolResultMsg {
  name: string;
  result: string;
  is_error: boolean;
  tool_use_id?: string;
}

export interface SessionUsage {
  input_tokens: number;
  output_tokens: number;
  cumulative_input_tokens: number;
  cumulative_output_tokens: number;
  context_utilization: number;
  model: string;
  provider: string;
  /**
   * Per-bucket token estimates that approximately sum to
   * `estimated_context_tokens`. Optional because older harness builds
   * omit it; the frontend treats an absent or all-zero breakdown as
   * "not available" and falls back to the legacy used/total view.
   */
  context_breakdown?: ContextBreakdown;
}

/**
 * Per-bucket context-window token estimates emitted by the harness.
 * `mcp_tokens` is reserved (always 0 today) for future MCP integration.
 */
export interface ContextBreakdown {
  system_prompt_tokens: number;
  tools_tokens: number;
  skills_tokens: number;
  mcp_tokens: number;
  subagents_tokens: number;
  conversation_tokens: number;
  /**
   * Tokens served from the upstream provider's prompt cache during the
   * most recent turn (Anthropic `cache_read_input_tokens` or OpenAI
   * `prompt_tokens_details.cached_tokens`). Describes what fraction of
   * the *conversation* bucket was a cache hit; the popover renders
   * this as a "Cached this turn" sub-row, not as a separate bucket.
   */
  cache_read_tokens?: number;
  /**
   * Tokens written to the upstream provider's prompt cache during the
   * most recent turn (Anthropic `cache_creation_input_tokens`).
   */
  cache_creation_tokens?: number;
}

export interface FileOp {
  path: string;
  operation: string;
}

export interface FilesChanged {
  created: string[];
  modified: string[];
  deleted: string[];
}

export interface AssistantMessageEnd {
  message_id: string;
  stop_reason: string;
  usage: SessionUsage;
  files_changed: FilesChanged;
}

export interface ErrorMsg {
  code: string;
  message: string;
  recoverable: boolean;
}

export type OutboundMessage =
  | { type: "session_ready" } & SessionReady
  | { type: "assistant_message_start" } & AssistantMessageStart
  | { type: "text_delta" } & TextDelta
  | { type: "thinking_delta" } & ThinkingDelta
  | { type: "tool_use_start" } & ToolUseStart
  | { type: "tool_result" } & ToolResultMsg
  | { type: "assistant_message_end" } & AssistantMessageEnd
  | { type: "error" } & ErrorMsg;
