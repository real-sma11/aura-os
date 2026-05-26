import type {
  BuildStep,
  TestStep,
  GitStep,
} from "../stores/event-store/index";

/* ------------------------------------------------------------------ */
/*  Persisted task-step normalisation                                  */
/*                                                                     */
/*  `tasks.build_steps` / `tasks.test_steps` / `tasks.git_steps` on    */
/*  the server mix two shapes:                                         */
/*    1. Native `build_verification_*` / `test_verification_*` events  */
/*       with the command at the top level.                            */
/*    2. Raw `tool_call_snapshot` / `tool_call_completed` events that  */
/*       the dev loop classifies as build/test/format/lint work via    */
/*       `classify_run_command_steps` in                               */
/*       `apps/aura-os-server/.../dev_loop.rs`. Those store the        */
/*       command under `input` (mirror of the Rust                     */
/*       `extract_run_command` helper).                                */
/*                                                                     */
/*  This module normalises both into the `BuildStep` / `TestStep` /    */
/*  `GitStep` shapes the UI expects so rows never render as            */
/*  "Running `undefined`".                                             */
/*                                                                     */
/*  Hoisted out of `use-task-output-hydration.ts` so the Run pane's    */
/*  `useTaskOutputView` and the Tasks-tab's `useTaskOutputHydration`   */
/*  share a single source of truth — previously the Run pane dropped   */
/*  build/test/git steps on the floor entirely because it passed       */
/*  `undefined` to `seedTaskOutput`.                                   */
/* ------------------------------------------------------------------ */

export interface PersistedStepShape {
  kind?: string;
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  type?: string;
  reason?: string;
  name?: string;
  id?: string;
  tests?: { name: string; status: string; message?: string }[];
  summary?: string;
  input?: unknown;
}

export interface PersistedGitStepShape {
  type?: string;
  kind?: string;
  reason?: string;
  commit_sha?: string;
  repo?: string;
  branch?: string;
  commits?: { sha: string; message: string }[];
}

function extractRunCommand(step: PersistedStepShape): string | undefined {
  if (step.name !== "run_command") return undefined;
  const input = step.input;
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const raw = obj.command;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  const program = obj.program;
  if (typeof program !== "string" || !program.trim()) return undefined;
  const args = Array.isArray(obj.args)
    ? obj.args.filter((v): v is string => typeof v === "string")
    : [];
  return args.length === 0 ? program.trim() : `${program.trim()} ${args.join(" ")}`;
}

// Collapse snapshot/completed pairs for the same tool call id so each
// command surfaces as a single row. When both exist we keep the
// `completed` event (it represents the final state).
function dedupeToolCallPairs(steps: PersistedStepShape[]): PersistedStepShape[] {
  const completedIds = new Set<string>();
  for (const s of steps) {
    if (s.type === "tool_call_completed" && typeof s.id === "string") {
      completedIds.add(s.id);
    }
  }
  return steps.filter(
    (s) => !(s.type === "tool_call_snapshot" && typeof s.id === "string" && completedIds.has(s.id)),
  );
}

export function mapBuildSteps(steps: PersistedStepShape[]): BuildStep[] {
  const kindMap: Record<string, BuildStep["kind"]> = {
    build_verification_skipped: "skipped",
    build_verification_started: "started",
    build_verification_passed: "passed",
    build_verification_failed: "failed",
    build_fix_attempt: "fix_attempt",
    tool_call_snapshot: "started",
    tool_call_completed: "passed",
  };
  return dedupeToolCallPairs(steps).map((s) => {
    const type = s.type ?? "";
    const toolCommand = extractRunCommand(s);
    return {
      kind: (kindMap[type] ?? s.kind ?? "started") as BuildStep["kind"],
      command: s.command ?? toolCommand,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      reason: (type === "build_verification_skipped" || s.kind === "skipped") ? (s.reason ?? s.stdout) : undefined,
      timestamp: 0,
    };
  });
}

export function mapTestSteps(steps: PersistedStepShape[]): TestStep[] {
  const kindMap: Record<string, TestStep["kind"]> = {
    test_verification_started: "started",
    test_verification_passed: "passed",
    test_verification_failed: "failed",
    test_fix_attempt: "fix_attempt",
    tool_call_snapshot: "started",
    tool_call_completed: "passed",
  };
  return dedupeToolCallPairs(steps).map((s) => {
    const type = s.type ?? "";
    const toolCommand = extractRunCommand(s);
    return {
      kind: (kindMap[type] ?? s.kind ?? "started") as TestStep["kind"],
      command: s.command ?? toolCommand,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      tests: s.tests ?? [],
      summary: s.summary,
      timestamp: 0,
    };
  });
}

export function mapGitSteps(steps: PersistedGitStepShape[]): GitStep[] {
  const kindMap: Record<string, GitStep["kind"]> = {
    git_committed: "committed",
    git_commit_failed: "commit_failed",
    git_commit_rolled_back: "commit_rolled_back",
    git_pushed: "pushed",
    git_push_failed: "push_failed",
  };
  return steps.map((s) => ({
    kind: (kindMap[s.type ?? ""] ?? s.kind ?? "committed") as GitStep["kind"],
    commitSha: s.commit_sha,
    reason: s.reason,
    repo: s.repo,
    branch: s.branch,
    commits: s.commits,
    timestamp: 0,
  }));
}
