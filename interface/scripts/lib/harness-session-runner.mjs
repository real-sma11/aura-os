import { calculateEstimatedCostUsd } from "./benchmark-pricing.mjs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readNumber(record, keys) {
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) {
      return record[key];
    }
  }
  return null;
}

export function readHarnessUsage(message) {
  const usage = asRecord(message.usage);
  if (!usage) return null;
  const inputTokens = Number(readNumber(usage, ["input_tokens", "inputTokens", "prompt_tokens"]) ?? 0);
  const outputTokens = Number(
    readNumber(usage, ["output_tokens", "outputTokens", "completion_tokens"]) ?? 0,
  );
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: Number(
      readNumber(usage, [
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
        "prompt_cache_miss_tokens",
      ]) ?? 0,
    ),
    cacheReadInputTokens: Number(
      readNumber(usage, [
        "cache_read_input_tokens",
        "cacheReadInputTokens",
        "prompt_cache_hit_tokens",
      ]) ?? 0,
    ),
    estimatedContextTokens: Number(usage.estimated_context_tokens ?? 0),
    contextUtilization: Number(usage.context_utilization ?? 0),
    model: typeof usage.model === "string" ? usage.model : null,
    provider: typeof usage.provider === "string" ? usage.provider : null,
  };
}

export function countHarnessFilesChanged(message) {
  const filesChanged = asRecord(message.files_changed);
  if (!filesChanged) return 0;
  return ["created", "modified", "deleted"].reduce((count, key) => {
    const value = filesChanged[key];
    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function toJsonMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function deriveWsBase(httpBase) {
  return httpBase
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://")
    .replace(/\/+$/, "");
}

/**
 * Phase A two-step open exchange. Replaces the legacy single-step
 * `WS /stream` + `session_init` first-frame handshake.
 *
 * @param {string} harnessBaseUrl  HTTP base URL of the harness node.
 * @param {object} options
 * @param {string} options.workspacePath
 * @param {string} [options.accessToken]
 * @param {string} [options.userId]
 * @param {number} [options.maxTurns]
 * @param {number} [options.maxTokens]
 */
export async function openHarnessSession(harnessBaseUrl, options = {}) {
  const {
    workspacePath,
    accessToken = "",
    userId = "",
    maxTurns = 16,
    maxTokens = 2048,
  } = options;

  // Step 1: POST /v1/run with the canonical RuntimeRequest body.
  const runtimeRequest = {
    type: {
      kind: "chat",
      params: { conversation_messages: [] },
    },
    agent_identity: {
      template_id: null,
      partition_id: null,
      persona: null,
      skills: [],
      system_prompt: null,
    },
    model: {
      id: null,
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : 2048,
      max_turns: Number.isFinite(maxTurns) ? maxTurns : 16,
      temperature: null,
      provider_overrides: null,
    },
    workspace: {
      workspace: null,
      project_path: workspacePath ?? null,
      git_repo_url: null,
      git_branch: null,
    },
    project: null,
    agent_permissions: { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
    tool_permissions: null,
    agent_capabilities: {
      installed_tools: [],
      installed_integrations: [],
      intent_classifier: null,
    },
    auth_jwt: accessToken || null,
    user_id: userId,
  };

  const httpBase = harnessBaseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const startedAt = Date.now();
  const res = await fetch(`${httpBase}/v1/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(runtimeRequest),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /v1/run failed (${res.status}): ${body}`);
  }
  const runStart = await res.json();
  const runId = runStart.run_id;
  const eventStreamUrl = runStart.event_stream_url || `/stream/${runId}`;
  const wsBase = deriveWsBase(httpBase);
  const wsUrl = eventStreamUrl.startsWith("ws://") || eventStreamUrl.startsWith("wss://")
    ? eventStreamUrl
    : `${wsBase}${eventStreamUrl.startsWith("/") ? eventStreamUrl : `/${eventStreamUrl}`}`;

  // Step 2: open WS /stream/:run_id.
  const socket = new WebSocket(wsUrl);
  const state = {
    socket,
    sessionReady: false,
    runId,
    runStartMs: Date.now() - startedAt,
  };

  return await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(state));
    socket.addEventListener("error", (event) => {
      reject(event.error ?? new Error("WebSocket error"));
    });
  });
}

/**
 * Wait for the harness's `session_ready` frame. The WS no longer
 * accepts a `session_init` send; the run was already created via
 * `POST /v1/run` and `session_ready` arrives unprompted.
 */
export async function waitForHarnessSessionReady(state) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "session_ready") {
        state.sessionReady = true;
        state.socket.removeEventListener("message", onMessage);
        resolve({
          ...message,
          sessionInitMs: Date.now() - startedAt,
        });
      } else if (message.type === "error") {
        state.socket.removeEventListener("message", onMessage);
        reject(new Error(message.message ?? "session init failed"));
      }
    };

    state.socket.addEventListener("message", onMessage);
  });
}

export async function runHarnessTurn(state, prompt, turnIndex = 1) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const turn = {
      turnIndex,
      prompt,
      text: "",
      toolNames: [],
      toolResults: [],
      usage: null,
      fileChangeCount: 0,
      rawEnd: null,
      firstEventAt: null,
      completedAt: null,
      wallClockMs: null,
      timeToFirstEventMs: null,
      stopReason: null,
      estimatedCostUsd: 0,
      pricing: null,
    };

    const markFirstEvent = () => {
      if (turn.firstEventAt == null) {
        turn.firstEventAt = Date.now();
        turn.timeToFirstEventMs = turn.firstEventAt - startedAt;
      }
    };

    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      switch (message.type) {
        case "text_delta":
          markFirstEvent();
          turn.text += message.text ?? "";
          break;
        case "thinking_delta":
          markFirstEvent();
          break;
        case "tool_use_start":
          markFirstEvent();
          if (typeof message.name === "string") {
            turn.toolNames.push(message.name);
          }
          break;
        case "tool_result":
          markFirstEvent();
          turn.toolResults.push({
            name: typeof message.name === "string" ? message.name : "unknown",
            isError: Boolean(message.is_error),
            resultPreview:
              typeof message.result === "string"
                ? message.result.slice(0, 240)
                : "",
          });
          break;
        case "assistant_message_end":
          markFirstEvent();
          turn.rawEnd = message;
          turn.usage = readHarnessUsage(message);
          turn.fileChangeCount = countHarnessFilesChanged(message);
          turn.stopReason = typeof message.stop_reason === "string" ? message.stop_reason : null;
          turn.completedAt = Date.now();
          turn.wallClockMs = turn.completedAt - startedAt;
          if (turn.usage) {
            const { estimatedCostUsd, pricing } = calculateEstimatedCostUsd(turn.usage);
            turn.estimatedCostUsd = estimatedCostUsd;
            turn.pricing = pricing;
          }
          state.socket.removeEventListener("message", onMessage);
          resolve(turn);
          break;
        case "error":
          state.socket.removeEventListener("message", onMessage);
          reject(new Error(message.message ?? "turn failed"));
          break;
        default:
          break;
      }
    };

    state.socket.addEventListener("message", onMessage);
    state.socket.send(toJsonMessage("user_message", {
      content: prompt,
    }));
  });
}
