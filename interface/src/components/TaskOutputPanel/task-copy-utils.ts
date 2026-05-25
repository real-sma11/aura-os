import type {
  DisplaySessionEvent,
  TimelineItem,
  ToolCallEntry,
} from "../../shared/types/stream";
import type {
  BuildStep,
  GitStep,
  TestStep,
} from "../../stores/event-store/index";
import type { PanelTaskFailureContext } from "../../stores/task-output-panel-store";
import {
  buildLiveStreamEvent,
  formatDisplayEventForCopy,
  type LiveCopyState,
} from "../../apps/process/components/ProcessSidekickContent/process-output-utils";

export interface TaskCopyFileOp {
  op: string;
  path: string;
}

export interface TaskCopyInput {
  title: string;
  status: string;
  durationLabel?: string | null;
  failureReason?: string | null;
  failureContext?: PanelTaskFailureContext | null;
  fileOps?: TaskCopyFileOp[];
  buildSteps?: BuildStep[];
  testSteps?: TestStep[];
  gitSteps?: GitStep[];
  events?: DisplaySessionEvent[];
  fallbackText?: string | null;
  liveState?: {
    streamingText: string;
    thinkingText: string;
    activeToolCalls: ToolCallEntry[];
    timeline: TimelineItem[];
  } | null;
}

function formatFailureContextLine(
  ctx: PanelTaskFailureContext | null | undefined,
): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.providerRequestId) parts.push(`req=${ctx.providerRequestId}`);
  if (ctx.model) parts.push(ctx.model);
  if (ctx.sseErrorType) parts.push(ctx.sseErrorType);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function formatBuildStep(step: BuildStep): string {
  const cmd = step.command ? ` \`${step.command}\`` : "";
  const reason = step.reason ? ` — ${step.reason}` : "";
  return `- ${step.kind}${cmd}${reason}`;
}

function formatTestStep(step: TestStep): string {
  const cmd = step.command ? ` \`${step.command}\`` : "";
  const summary = step.summary ? ` — ${step.summary}` : "";
  const failed = step.tests
    .filter((t) => t.status !== "passed" && t.status !== "ok")
    .map((t) => `    - ${t.status}: ${t.name}${t.message ? ` — ${t.message}` : ""}`);
  const lines = [`- ${step.kind}${cmd}${summary}`];
  if (failed.length > 0) lines.push(...failed);
  return lines.join("\n");
}

function formatGitStep(step: GitStep): string {
  const sha = step.commitSha ? ` ${step.commitSha.slice(0, 7)}` : "";
  const reason = step.reason ? ` — ${step.reason}` : "";
  if (step.kind === "pushed" && step.commits && step.commits.length > 0) {
    const commits = step.commits
      .map((c) => `    - ${c.sha.slice(0, 7)} ${c.message}`)
      .join("\n");
    return `- pushed${reason}\n${commits}`;
  }
  return `- ${step.kind}${sha}${reason}`;
}

function buildOutputSection(input: TaskCopyInput): string | null {
  const events = input.events ?? [];
  const live: LiveCopyState | null = input.liveState
    ? {
        events: [],
        streamingText: input.liveState.streamingText,
        thinkingText: input.liveState.thinkingText,
        activeToolCalls: input.liveState.activeToolCalls,
        timeline: input.liveState.timeline,
      }
    : null;

  const liveEvent = live ? buildLiveStreamEvent(live) : null;
  const messages: DisplaySessionEvent[] = [
    ...events,
    ...(liveEvent ? [liveEvent] : []),
  ];

  const rendered = messages
    .map((message) => formatDisplayEventForCopy(message))
    .filter(Boolean);

  if (rendered.length > 0) {
    return rendered.join("\n\n");
  }

  if (input.fallbackText && input.fallbackText.trim()) {
    return input.fallbackText.trim();
  }

  return null;
}

export function buildTaskCopyText(input: TaskCopyInput): string {
  const lines: string[] = [];
  const heading = `# ${input.title || "Task"} [${input.status}]`;
  lines.push(heading);

  const meta: string[] = [];
  meta.push(`Status: ${input.status}`);
  if (input.durationLabel) meta.push(`Duration: ${input.durationLabel}`);
  if (input.failureReason) meta.push(`Failure reason: ${input.failureReason}`);
  const ctxLine = formatFailureContextLine(input.failureContext);
  if (ctxLine) meta.push(`Provider context: ${ctxLine}`);
  lines.push(meta.join("\n"));

  const sections: string[] = [];

  if (input.fileOps && input.fileOps.length > 0) {
    const body = input.fileOps.map((f) => `- ${f.op}: ${f.path}`).join("\n");
    sections.push(`## Files\n${body}`);
  }

  if (input.buildSteps && input.buildSteps.length > 0) {
    const body = input.buildSteps.map(formatBuildStep).join("\n");
    sections.push(`## Build Verification\n${body}`);
  }

  if (input.testSteps && input.testSteps.length > 0) {
    const body = input.testSteps.map(formatTestStep).join("\n");
    sections.push(`## Test Verification\n${body}`);
  }

  if (input.gitSteps && input.gitSteps.length > 0) {
    const body = input.gitSteps.map(formatGitStep).join("\n");
    sections.push(`## Git Activity\n${body}`);
  }

  const output = buildOutputSection(input);
  if (output) {
    sections.push(`## Output\n${output}`);
  }

  if (sections.length > 0) {
    lines.push(sections.join("\n\n"));
  }

  return lines.join("\n\n").trim();
}
