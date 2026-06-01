import { type MouseEvent } from "react";
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
import { useChatPanelStreamKey } from "../../features/chat-ui/ChatPanel/chat-panel-context";
import { useSubAgentPaneActions } from "../../stores/subagent-pane-store";
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
 * "Open" button pushes the owning `ChatPanel` into an iOS-style
 * slide-over sub-pane streaming the child run's live (and promptable)
 * thread. Quota / depth rejections surface as a rejected pill with the
 * reason in the body.
 */
export function SubAgentBlock({ entry, defaultExpanded }: SubAgentBlockProps) {
  const parentStreamKey = useChatPanelStreamKey();
  const { openPane } = useSubAgentPaneActions();

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
  const canOpen = !!childRunId && !!parentStreamKey;

  const summary = firstLine(prompt);

  const openModal = (event: MouseEvent<HTMLButtonElement>): void => {
    // Stop the click from also toggling the Block's expand/collapse.
    event.stopPropagation();
    if (!childRunId || !parentStreamKey) return;
    openPane(parentStreamKey, {
      childRunId,
      parentToolUseId: entry.id,
      subagentType,
      prompt,
      state,
      reason,
      subagentSessionId: entry.subagentSessionId,
    });
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
    <Block
      icon={<Bot size={12} />}
      title={label}
      summary={summary || undefined}
      status={blockStatusFor(state)}
      defaultExpanded={defaultExpanded ?? false}
      copy={{ getText: getCopyText, ariaLabel: `Copy ${label} subagent` }}
      trailing={
        <span className={styles.trailing}>
          <Badge variant={subagentBadgeVariant(state)} pulse={state === "running"}>
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
        {reason && <p className={styles.reason}>{reason}</p>}
      </div>
    </Block>
  );
}
