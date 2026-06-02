// Demo recorder frontend bridge.
//
// The native desktop shell opens a dedicated "demo" window, marks it with
// `window.__AURA_DEMO_RECORDING__`, starts an ffmpeg screen recording, and
// then calls `window.__AURA_DEMO_BRIDGE__.run(instruction)` to drive the
// window. `run` opens a fresh standalone-agent chat, sends the instruction
// through the SAME path the chat input uses (so the agent invokes its real
// tools, including the in-app browser), and resolves when the agent turn
// finishes streaming. When this is the recording window, completion is
// reported back to the shell via the `demo-complete` IPC message so it can
// stop ffmpeg and finalize the file.

import { getIsStreaming, keyForAgentSession, useStreamStore } from "../hooks/stream/store";
import { peekPartitionAgentReplay } from "../hooks/stream/partition-state";
import { getLastStandaloneAgentId } from "../utils/storage";
import { windowCommand } from "./windowCommand";

declare global {
  interface Window {
    /** Set (per-window) by the native shell's init script on the demo window. */
    __AURA_DEMO_RECORDING__?: string;
    __AURA_DEMO_BRIDGE__?: {
      version: number;
      run: (
        instruction: string,
        opts?: { agentId?: string; timeoutMs?: number },
      ) => Promise<DemoRunResult>;
    };
  }
}

export interface DemoRunResult {
  ok: boolean;
  error?: string;
}

type NavigateFn = (to: string) => void;

const DEFAULT_TIMEOUT_MS = 280_000;
const PANEL_READY_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isDemoRecordingWindow(): boolean {
  return typeof window !== "undefined" && typeof window.__AURA_DEMO_RECORDING__ === "string";
}

export function postDesktopIpc(message: string): void {
  try {
    windowCommand(message);
  } catch {
    // Non-desktop / no IPC bridge: ignore.
  }
}

function sessionIdFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("session");
  } catch {
    return null;
  }
}

/**
 * Wait until a standalone-agent chat panel is mounted for `agentId` and has
 * registered its imperative `sendFn` (in the partition-replay map). Returns
 * the partition key + send function, or `null` on timeout.
 */
async function waitForSendFn(
  agentId: string,
  timeoutMs: number,
): Promise<{ key: string; sendFn: (args: { content: string; action: string | null }) => Promise<void> } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessionId = sessionIdFromUrl();
    const candidateKeys = [keyForAgentSession(agentId, sessionId), keyForAgentSession(agentId, null)];
    for (const key of candidateKeys) {
      const replay = peekPartitionAgentReplay(key);
      if (replay?.sendFn) {
        return { key, sendFn: replay.sendFn };
      }
    }
    await sleep(150);
  }
  return null;
}

/**
 * Resolve once the agent turn for `agentId` has fully finished streaming
 * (covers multi-step tool turns, since `isStreaming` stays true until the
 * harness emits the final completion). Resolves with `{ ok: false }` on
 * timeout.
 */
function waitForTurnCompletion(agentId: string, timeoutMs: number): Promise<DemoRunResult> {
  return new Promise((resolve) => {
    const prefix = `${agentId}:`;
    const startedAt = Date.now();
    let sawStreaming = false;
    let settled = false;

    const finish = (result: DemoRunResult) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearInterval(interval);
      resolve(result);
    };

    const check = () => {
      const { entries } = useStreamStore.getState();
      const keys = Object.keys(entries).filter((key) => key.startsWith(prefix));
      const streaming = keys.some((key) => entries[key]?.isStreaming);
      if (streaming) {
        sawStreaming = true;
      }
      if (sawStreaming && !streaming) {
        finish({ ok: true });
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        finish({ ok: sawStreaming, error: sawStreaming ? undefined : "timed out waiting for the agent" });
      }
    };

    const unsubscribe = useStreamStore.subscribe(check);
    // Poll as a backstop in case the terminal transition produces no
    // further store update we can observe.
    const interval = setInterval(check, 500);
    check();
  });
}

async function runDemoInstructionInner(
  navigate: NavigateFn,
  instruction: string,
  opts?: { agentId?: string; timeoutMs?: number },
): Promise<DemoRunResult> {
  const trimmed = instruction.trim();
  if (!trimmed) {
    return { ok: false, error: "instruction is empty" };
  }
  const agentId = opts?.agentId ?? getLastStandaloneAgentId();
  if (!agentId) {
    return { ok: false, error: "no standalone agent available to run the demo" };
  }
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  navigate(`/agents/${agentId}`);

  const found = await waitForSendFn(agentId, PANEL_READY_TIMEOUT_MS);
  if (!found) {
    return { ok: false, error: "chat panel did not become ready" };
  }

  // Let the panel settle (route redirects / history mount) before sending.
  await sleep(400);

  // Don't fire into an in-flight turn.
  const sendDeadline = Date.now() + 8_000;
  while (getIsStreaming(found.key) && Date.now() < sendDeadline) {
    await sleep(150);
  }

  try {
    await found.sendFn({ content: trimmed, action: null });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  // Give `isStreaming` a moment to flip true so the completion waiter
  // observes the rising edge.
  await sleep(400);
  return waitForTurnCompletion(agentId, timeoutMs);
}

/**
 * Public entry point invoked by the native shell on the demo window. Always
 * reports `demo-complete` back to the shell (when running inside a recording
 * window) so ffmpeg is stopped even on failure.
 */
export async function runDemoInstruction(
  navigate: NavigateFn,
  instruction: string,
  opts?: { agentId?: string; timeoutMs?: number },
): Promise<DemoRunResult> {
  let result: DemoRunResult;
  try {
    result = await runDemoInstructionInner(navigate, instruction, opts);
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (isDemoRecordingWindow()) {
    postDesktopIpc("demo-complete");
  }
  return result;
}
