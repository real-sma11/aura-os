import { Button } from "@cypher-asi/zui";
import {
  ArrowRightCircle,
  CheckSquare,
  ClipboardList,
  ExternalLink,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useSidekickStore } from "../../../stores/sidekick-store";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { Block } from "../Block";
import styles from "./renderers.module.css";

interface TaskBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

const VERBS: Record<string, { done: string; pending: string }> = {
  create_task: { done: "Task Created", pending: "Creating task..." },
  update_task: { done: "Task Updated", pending: "Updating task..." },
  transition_task: { done: "Task Moved", pending: "Moving task..." },
  delete_task: { done: "Task Deleted", pending: "Deleting task..." },
  retry_task: { done: "Task Retried", pending: "Retrying task..." },
  run_task: { done: "Task Ran", pending: "Running task..." },
};

function iconFor(name: string): ReactNode {
  switch (name) {
    case "transition_task": return <ArrowRightCircle size={12} />;
    case "update_task": return <CheckSquare size={12} />;
    case "delete_task": return <Trash2 size={12} />;
    case "retry_task": return <RotateCcw size={12} />;
    case "run_task": return <Play size={12} />;
    default: return <ClipboardList size={12} />;
  }
}

interface ResolvedHeader {
  /** Tool name with pending suffix when applicable (drives the title slot). */
  title: string;
  /** Task name / id for the smaller secondary summary slot. */
  context: string;
  /** Only set for transition_task, where the destination state is meta-info. */
  badge?: string;
}

function changedFieldsSummary(entry: ToolCallEntry): string {
  const raw = entry.input.changed_fields;
  if (!Array.isArray(raw)) return "";
  const fields = raw.filter((f): f is string => typeof f === "string" && f.length > 0);
  return fields.join(", ");
}

function resolveHeader(entry: ToolCallEntry): ResolvedHeader {
  const inputTitle = (entry.input.title as string) || "";
  const taskId = (entry.input.task_id as string) || "";
  const transitionTo = (entry.input.status as string) || "";
  const transitionFrom = (entry.input.from_status as string) || "";

  const verbs = VERBS[entry.name] ?? VERBS.create_task;
  const title = entry.pending ? verbs.pending : verbs.done;
  // For `update_task` blocks (server-side broadcasts of non-status
  // field writes), surface the list of changed fields in the summary
  // slot — without this the block header is just "Task Updated" with
  // no indication of WHAT was updated.
  const fieldsSummary =
    entry.name === "update_task" ? changedFieldsSummary(entry) : "";
  const context =
    fieldsSummary || inputTitle || (taskId ? taskId.slice(0, 12) : "");
  // For `transition_task`, show the full edge ("in_progress -> done")
  // when the upstream broadcast carries `from_status`; older payloads
  // without it fall back to the destination-only "-> done" form.
  let badge: string | undefined;
  if (!entry.pending && entry.name === "transition_task" && transitionTo) {
    badge = transitionFrom
      ? `${transitionFrom} -> ${transitionTo}`
      : `-> ${transitionTo}`;
  }

  return { title, context, badge };
}

export function TaskBlock({ entry, defaultExpanded }: TaskBlockProps) {
  const { title, context, badge } = resolveHeader(entry);
  const description = (entry.input.description as string) || "";
  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  const taskId = (entry.input.task_id as string) || "";
  const task = useSidekickStore((s) =>
    taskId ? s.tasks.find((t) => t.task_id === taskId) : undefined,
  );
  const pushPreview = useSidekickStore((s) => s.pushPreview);

  const canOpenInSidekick = !!task && !entry.pending && !entry.isError;

  return (
    <Block
      icon={iconFor(entry.name)}
      title={title}
      summary={context || undefined}
      badge={badge}
      status={status}
      defaultExpanded={defaultExpanded ?? false}
      flushBody
      copy={{
        getText: () =>
          [context, description].filter((s) => s.length > 0).join("\n\n") || title,
        ariaLabel: `Copy ${context || title}`,
      }}
    >
      {context ? <div className={styles.taskTitle}>{context}</div> : null}
      {description ? <div className={styles.taskDesc}>{description}</div> : null}
      {entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : null}
      {canOpenInSidekick && task ? (
        <div className={styles.taskActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={12} />}
            onClick={() => pushPreview({ kind: "task", task })}
          >
            Open in sidekick
          </Button>
        </div>
      ) : null}
    </Block>
  );
}
