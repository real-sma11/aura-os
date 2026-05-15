/**
 * Phase 4 vitest for the `/api/public/*` API client. Covers:
 *
 * - `setupPublicSession()` parses a valid response and rejects
 *   malformed shapes at the boundary (rules-typescript > DATA
 *   VALIDATION).
 * - The streaming clients route SSE frames through the typed
 *   reducers: chat dispatches `text_delta` + `limit` + `error`,
 *   and the media clients dispatch `generation_progress` +
 *   `generation_completed` + `limit` (rejecting payloads that
 *   miss the required fields).
 *
 * The streaming clients are tested by mocking `streamSSE` so we
 * can synthesise SSE frames inline without setting up a real
 * server. The mock captures the per-call `onEvent` callback and
 * we drive it directly through the `dispatch*` paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SseEventCallback = (eventType: string, payload: unknown) => void;
interface MockedStreamSSEArgs {
  url: string;
  init: RequestInit;
  callbacks: { onEvent: SseEventCallback; onError?: (e: Error) => void };
}

const streamSSEMock = vi.fn();
const resolveApiUrlMock = vi.fn((path: string) => `http://test.local${path}`);

vi.mock("../shared/api/sse", () => ({
  streamSSE: (
    url: string,
    init: RequestInit,
    callbacks: { onEvent: SseEventCallback; onError?: (e: Error) => void },
    _signal?: AbortSignal,
  ) => {
    streamSSEMock({ url, init, callbacks });
    return Promise.resolve();
  },
}));

vi.mock("../shared/lib/host-config", () => ({
  resolveApiUrl: (path: string) => resolveApiUrlMock(path),
}));

beforeEach(() => {
  streamSSEMock.mockClear();
  resolveApiUrlMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setupPublicSession", () => {
  it("parses a well-formed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: "abc.def.ghi", turn_count: 0, limit: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { setupPublicSession } = await import("./public-chat");
    const response = await setupPublicSession();

    expect(response).toEqual({
      token: "abc.def.ghi",
      turn_count: 0,
      limit: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://test.local/api/public/setup",
    );
  });

  it("throws when the response shape is malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 123, turn_count: "0", limit: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { setupPublicSession } = await import("./public-chat");
    await expect(setupPublicSession()).rejects.toThrow(
      /did not match expected shape/i,
    );
  });

  it("throws when the response status is non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { setupPublicSession } = await import("./public-chat");
    await expect(setupPublicSession()).rejects.toThrow(/public_setup failed/i);
  });
});

describe("streamPublicChat dispatch", () => {
  function captureCallbacks(): MockedStreamSSEArgs {
    const last = streamSSEMock.mock.calls[
      streamSSEMock.mock.calls.length - 1
    ][0] as MockedStreamSSEArgs;
    return last;
  }

  it("dispatches a well-formed text_delta to onDelta", async () => {
    const onDelta = vi.fn();
    const onLimit = vi.fn();
    const onError = vi.fn();
    const { streamPublicChat } = await import("./public-chat");
    streamPublicChat({
      token: "tok",
      sessionId: "s-1",
      history: [],
      message: "hi",
      mode: "code",
      onDelta,
      onLimit,
      onError,
    });
    const captured = captureCallbacks();
    captured.callbacks.onEvent("text_delta", { text: "hello" });
    expect(onDelta).toHaveBeenCalledWith("hello");
    expect(onLimit).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects a text_delta missing the required `text` field", async () => {
    const onDelta = vi.fn();
    const { streamPublicChat } = await import("./public-chat");
    streamPublicChat({
      token: "tok",
      sessionId: "s-1",
      history: [],
      message: "hi",
      mode: "code",
      onDelta,
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = captureCallbacks();
    captured.callbacks.onEvent("text_delta", { wrong: "field" });
    captured.callbacks.onEvent("text_delta", null);
    captured.callbacks.onEvent("text_delta", { text: 42 });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it("dispatches a well-formed limit frame to onLimit", async () => {
    const onLimit = vi.fn();
    const { streamPublicChat } = await import("./public-chat");
    streamPublicChat({
      token: "tok",
      sessionId: "s-1",
      history: [],
      message: "hi",
      mode: "code",
      onDelta: vi.fn(),
      onLimit,
      onError: vi.fn(),
    });
    const captured = captureCallbacks();
    captured.callbacks.onEvent("limit", {
      kind: "limit",
      turn_count: 2,
      limit: 3,
    });
    expect(onLimit).toHaveBeenCalledWith(2);
  });

  it("rejects a limit frame missing required fields", async () => {
    const onLimit = vi.fn();
    const { streamPublicChat } = await import("./public-chat");
    streamPublicChat({
      token: "tok",
      sessionId: "s-1",
      history: [],
      message: "hi",
      mode: "code",
      onDelta: vi.fn(),
      onLimit,
      onError: vi.fn(),
    });
    const captured = captureCallbacks();
    captured.callbacks.onEvent("limit", { turn_count: 2, limit: 3 });
    captured.callbacks.onEvent("limit", { kind: "limit", limit: 3 });
    captured.callbacks.onEvent("limit", null);
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("forwards an error frame to onError when shape matches", async () => {
    const onError = vi.fn();
    const { streamPublicChat } = await import("./public-chat");
    streamPublicChat({
      token: "tok",
      sessionId: "s-1",
      history: [],
      message: "hi",
      mode: "code",
      onDelta: vi.fn(),
      onLimit: vi.fn(),
      onError,
    });
    const captured = captureCallbacks();
    captured.callbacks.onEvent("error", { code: "BOOM", message: "fell over" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toContain("fell over");
  });

  it("sends Authorization Bearer + JSON body for a chat call", async () => {
    const { streamPublicChat } = await import("./public-chat");
    streamPublicChat({
      token: "guest.jwt",
      sessionId: "s-1",
      history: [{ role: "user", content: "earlier" }],
      message: "now",
      mode: "plan",
      onDelta: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = captureCallbacks();
    expect(captured.url).toBe("/api/public/chat/stream");
    const headers = captured.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer guest.jwt");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(captured.init.body as string) as {
      message: string;
      mode: string;
      history: Array<{ role: string; content: string }>;
    };
    expect(body.message).toBe("now");
    expect(body.mode).toBe("plan");
    expect(body.history).toEqual([{ role: "user", content: "earlier" }]);
  });
});

describe("streamPublicImage / streamPublicVideo / streamPublicModel3d dispatch", () => {
  function lastArgs(): MockedStreamSSEArgs {
    return streamSSEMock.mock.calls[
      streamSSEMock.mock.calls.length - 1
    ][0] as MockedStreamSSEArgs;
  }

  it("image dispatches generation_progress with `percent` → fraction", async () => {
    const onProgress = vi.fn();
    const { streamPublicImage } = await import("./public-chat");
    streamPublicImage({
      token: "t",
      prompt: "a kite",
      onProgress,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    captured.callbacks.onEvent("generation_progress", {
      percent: 25,
      message: "warming up",
    });
    expect(onProgress).toHaveBeenCalledWith({
      fraction: 0.25,
      message: "warming up",
    });
  });

  it("image rejects a generation_progress with non-number percent", async () => {
    const onProgress = vi.fn();
    const { streamPublicImage } = await import("./public-chat");
    streamPublicImage({
      token: "t",
      prompt: "a kite",
      onProgress,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    captured.callbacks.onEvent("generation_progress", { percent: "wrong" });
    captured.callbacks.onEvent("generation_progress", null);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("video dispatches generation_completed with imageUrl alias", async () => {
    const onCompleted = vi.fn();
    const { streamPublicVideo } = await import("./public-chat");
    streamPublicVideo({
      token: "t",
      prompt: "x",
      onProgress: vi.fn(),
      onCompleted,
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    captured.callbacks.onEvent("generation_completed", {
      imageUrl: "https://cdn.example.com/v.mp4",
    });
    expect(onCompleted).toHaveBeenCalledWith("https://cdn.example.com/v.mp4");
  });

  it("model3d falls back to nested payload.modelUrl", async () => {
    const onCompleted = vi.fn();
    const { streamPublicModel3d } = await import("./public-chat");
    streamPublicModel3d({
      token: "t",
      prompt: "x",
      sourceImage: "https://cdn.example.com/seed.png",
      onProgress: vi.fn(),
      onCompleted,
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    captured.callbacks.onEvent("generation_completed", {
      payload: { modelUrl: "https://cdn.example.com/m.glb" },
    });
    expect(onCompleted).toHaveBeenCalledWith("https://cdn.example.com/m.glb");
  });

  it("media completed frame missing every URL alias is dropped", async () => {
    const onCompleted = vi.fn();
    const { streamPublicImage } = await import("./public-chat");
    streamPublicImage({
      token: "t",
      prompt: "x",
      onProgress: vi.fn(),
      onCompleted,
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    captured.callbacks.onEvent("generation_completed", { unrelated: "field" });
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("limit frame on a media stream forwards turn_count", async () => {
    const onLimit = vi.fn();
    const { streamPublicVideo } = await import("./public-chat");
    streamPublicVideo({
      token: "t",
      prompt: "x",
      onProgress: vi.fn(),
      onCompleted: vi.fn(),
      onLimit,
      onError: vi.fn(),
    });
    const captured = lastArgs();
    captured.callbacks.onEvent("limit", {
      kind: "limit",
      turn_count: 3,
      limit: 3,
    });
    expect(onLimit).toHaveBeenCalledWith(3);
  });

  it("model3d picks image_data when sourceImage is a base64 data URL", async () => {
    const { streamPublicModel3d } = await import("./public-chat");
    streamPublicModel3d({
      token: "t",
      prompt: "x",
      sourceImage: "data:image/png;base64,AAA",
      onProgress: vi.fn(),
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    const body = JSON.parse(captured.init.body as string) as {
      image_data?: string;
      image_url?: string;
    };
    expect(body.image_data).toBe("data:image/png;base64,AAA");
    expect(body.image_url).toBeUndefined();
  });

  it("image carries the optional sourceUrl through as source_url", async () => {
    const { streamPublicImage } = await import("./public-chat");
    streamPublicImage({
      token: "t",
      prompt: "x",
      sourceUrl: "https://cdn.example.com/seed.png",
      onProgress: vi.fn(),
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
    });
    const captured = lastArgs();
    const body = JSON.parse(captured.init.body as string) as {
      source_url?: string;
      prompt?: string;
    };
    expect(body.source_url).toBe("https://cdn.example.com/seed.png");
    expect(body.prompt).toBe("x");
  });
});
