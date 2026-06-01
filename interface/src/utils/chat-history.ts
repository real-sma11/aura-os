import type { ChatContentBlock } from "../shared/types";
import type { ToolCallEntry, ArtifactRef } from "../shared/types/stream";
import { normalizeToolInput } from "./tool-input";
import { isSubagentState } from "../shared/utils/subagent";

export function extractToolCalls(blocks: ChatContentBlock[]): ToolCallEntry[] | undefined {
  const toolUseBlocks = blocks.filter(
    (b): b is Extract<ChatContentBlock, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (toolUseBlocks.length === 0) return undefined;

  const resultMap = new Map<string, { result: string; isError: boolean }>();
  for (const b of blocks) {
    if (b.type === "tool_result") {
      resultMap.set(b.tool_use_id, {
        result: b.content ?? "",
        isError: b.is_error === true,
      });
    }
  }

  return toolUseBlocks.map((b) => {
    const res = resultMap.get(b.id);
    return {
      id: b.id ?? "",
      name: b.name ?? "",
      input: normalizeToolInput(b.input),
      result: res?.result,
      isError: res?.isError,
      pending: false,
      // Rehydrate the subagent linkage the server stamps onto a `task`
      // tool_use block so a history-reopened card can re-attach to the
      // child thread and render its terminal status. Undefined keys are
      // omitted so non-`task` tool calls keep their plain shape.
      ...(b.child_run_id ? { subagentRunId: b.child_run_id } : {}),
      ...(b.subagent_session_id ? { subagentSessionId: b.subagent_session_id } : {}),
      ...(b.subagent_type ? { subagentType: b.subagent_type } : {}),
      ...(b.prompt ? { subagentPrompt: b.prompt } : {}),
      ...(isSubagentState(b.subagent_status)
        ? { subagentStatus: b.subagent_status }
        : {}),
      ...(b.subagent_reason ? { subagentReason: b.subagent_reason } : {}),
    };
  });
}

export function extractArtifactRefs(blocks: ChatContentBlock[]): ArtifactRef[] | undefined {
  const refs: ArtifactRef[] = [];
  for (const b of blocks) {
    if (b.type === "task_ref") {
      if (b.task_id) refs.push({ kind: "task", id: b.task_id, title: b.title ?? "" });
    } else if (b.type === "spec_ref") {
      if (b.spec_id) refs.push({ kind: "spec", id: b.spec_id, title: b.title ?? "" });
    }
  }
  return refs.length > 0 ? refs : undefined;
}
