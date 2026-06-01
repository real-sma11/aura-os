import type { ContextBucketId } from "../../stores/sidekick-store";

/**
 * Human-readable labels for each context bucket. Shared between the
 * Sidekick preview body and its header title. Mirrors the row labels in
 * `ContextUsageIndicator`'s `buildBucketRows`.
 */
const BUCKET_LABELS: Record<ContextBucketId, string> = {
  system_prompt: "System prompt",
  tools: "Tools",
  skills: "Skills",
  mcp: "MCP",
  subagents: "Subagents",
  conversation: "Conversation",
};

/** Human label for a context bucket (e.g. `"System prompt"`). */
export function contextBucketLabel(bucketId: ContextBucketId): string {
  return BUCKET_LABELS[bucketId];
}
