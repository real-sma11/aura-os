import { useState, type MouseEvent } from "react";
import { Bot } from "lucide-react";
import { Badge } from "@cypher-asi/zui";
import type { ToolCallEntry } from "../../shared/types/stream";
import { subagentTypeLabel } from "../../constants/tools";
import {
  resolveSubagentState,
  subagentBadgeVariant,
  subagentStateLabel,
} from "../../shared/utils/subagent";
import { Block, type BlockStatus } from "../Block/Block";
import { SubAgentModal } from "../SubAgentModal";
import styles from "./SubAgentBlock.module.css";

interface SubAgentBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

function readString(
  input: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function firstLine(text: string, max = 96): string {
  const line = text.split("\n", 1)[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function blockStatusFor(state: ReturnType<typeof resolveSubagentState>): BlockStatus {
  if (state === "running") return "pending";
  if (state === "failed" || state === "timeout" || state === "rejected") {
    return "error";
  }
  return "done";
}

/**
 * Renders a `task` tool call as a clickable subagent card. The card
 * shows the subagent type, a status pill, and a prompt summary; the
 * "Open" button reveals a modal streaming the child run's live thread
 * (chat-within-a-chat). Quota / depth rejections surface as a rejected
 * pill with the reason in the body.
 */
export function SubAgentBlock({ entry, defaultExpanded }: SubAgentBlockProps) {
  const [open, setOpen] = useState(false);

  const subagentType =
    entry.subagentType ?? readString(entry.input, "subagent_type") ?? "";
  const prompt =
    entry.subagentPrompt ??
    readString(entry.input, "prompt", "description") ??
    "";
  const state = resolveSubagentState(entry);
  const label = subagentTypeLabel(subagentType);
  const reason = entry.subagentReason;
  const childRunId = entry.subagentRunId;
  const canOpen = !!childRunId;

  const summary = firstLine(prompt);

  const openModal = (event: MouseEvent<HTMLButtonElement>): void => {
    // Stop the click from also toggling the Block's expand/collapse.
    event.stopPropagation();
    if (canOpen) setOpen(true);
  };

  const getCopyText = (): string =>
    [
      `Subagent: ${label}`,
      `Status: ${subagentStateLabel(state)}`,
      reason ? `Reason: ${reason}` : null,
      prompt ? `\n${prompt}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

  return (
    <>
      <Block
        icon={<Bot size={12} />}
        title={label}
        summary={summary || undefined}
        status={blockStatusFor(state)}
        defaultExpanded={defaultExpanded ?? false}
        copy={{ getText: getCopyText, ariaLabel: `Copy ${label} subagent` }}
        trailing={
          <span className={styles.trailing}>
            <Badge
              variant={subagentBadgeVariant(state)}
              pulse={state === "running"}
            >
              {subagentStateLabel(state)}
            </Badge>
            <button
              type="button"
              className={styles.openButton}
              onClick={openModal}
              disabled={!canOpen}
              aria-label={
                canOpen
                  ? `Open ${label} subagent thread`
                  : `${label} subagent thread not available yet`
              }
              title={
                canOpen ? undefined : "Live thread becomes available once the subagent starts"
              }
            >
              Open
            </button>
          </span>
        }
      >
        <div className={styles.body}>
          {prompt ? (
            <p className={styles.prompt}>{prompt}</p>
          ) : (
            <p className={styles.muted}>No prompt was recorded for this subagent.</p>
          )}
          {reason && (
            <p className={styles.reason}>{reason}</p>
          )}
          {/*
            TODO(history-reopen): a `task` card hydrated from persisted
            history has no `subagentRunId` (the server does not store the
            child run id on the tool call), so "Open" is disabled. Wiring
            the list endpoint
            (GET /api/projects/:p/agents/:a/sessions/:s/subagents) to
            backfill `subagentRunId` would let finished threads reopen.
          */}
        </div>
      </Block>
      {open && childRunId && (
        <SubAgentModal
          isOpen={open}
          onClose={() => setOpen(false)}
          childRunId={childRunId}
          parentToolUseId={entry.id}
          subagentType={subagentType}
          prompt={prompt}
          state={state}
          reason={reason}
        />
      )}
    </>
  );
}
