/**
 * Phase 4 vitest for the media-mode dispatcher in
 * `dispatch-media.ts`. Pins the contract the `usePublicChat` hook
 * depends on:
 *
 * - Each mode (image / video / model3d) calls the matching
 *   `streamPublic*` client with the right top-level args.
 * - The shared progress / completed callbacks land on the
 *   per-call setters / `onCompleted(mode, url)` shape the hook
 *   expects.
 * - A `limit` frame on a media stream forwards `turn_count`
 *   through `onLimit`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedCall {
  fn: "image" | "video" | "model3d";
  args: Record<string, unknown>;
}

const calls: CapturedCall[] = [];

vi.mock("../../api/public-chat", () => ({
  streamPublicImage: (args: Record<string, unknown>) => {
    calls.push({ fn: "image", args });
    return { close: vi.fn() };
  },
  streamPublicVideo: (args: Record<string, unknown>) => {
    calls.push({ fn: "video", args });
    return { close: vi.fn() };
  },
  streamPublicModel3d: (args: Record<string, unknown>) => {
    calls.push({ fn: "model3d", args });
    return { close: vi.fn() };
  },
}));

import { dispatchMediaTurn, type MediaStreamSetters } from "./dispatch-media";

function buildSetters(): MediaStreamSetters & {
  setIsStreaming: ReturnType<typeof vi.fn>;
  setStreamingText: ReturnType<typeof vi.fn>;
  setProgressText: ReturnType<typeof vi.fn>;
} {
  return {
    setIsStreaming: vi.fn(),
    setStreamingText: vi.fn(),
    setProgressText: vi.fn(),
  };
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dispatchMediaTurn", () => {
  it("opens the image stream client when mode is image", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "image",
      token: "tok",
      prompt: "a kite",
      sourceImage: "https://cdn.example.com/seed.png",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("image");
    expect(calls[0].args.token).toBe("tok");
    expect(calls[0].args.prompt).toBe("a kite");
    expect(calls[0].args.sourceUrl).toBe("https://cdn.example.com/seed.png");
    expect(setters.setIsStreaming).toHaveBeenCalledWith(true);
    expect(setters.setProgressText).toHaveBeenCalled();
  });

  it("opens the video stream client when mode is video", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "video",
      token: "tok",
      prompt: "a kite",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("video");
  });

  it("opens the model3d stream client when mode is model3d", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "model3d",
      token: "tok",
      prompt: "a kite",
      sourceImage: "data:image/png;base64,AAA",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("model3d");
    expect(calls[0].args.sourceImage).toBe("data:image/png;base64,AAA");
  });

  it("model3d falls back to empty sourceImage when none is provided", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "model3d",
      token: "tok",
      prompt: "a kite",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("model3d");
    expect(calls[0].args.sourceImage).toBe("");
  });

  it("forwards generation_completed url through onCompleted with the mode tag", () => {
    const setters = buildSetters();
    const onCompleted = vi.fn();
    dispatchMediaTurn({
      mode: "image",
      token: "tok",
      prompt: "x",
      setters,
      onCompleted,
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    const captured = calls[0].args as {
      onCompleted: (url: string) => void;
    };
    captured.onCompleted("https://cdn.example.com/asset.png");
    expect(onCompleted).toHaveBeenCalledWith(
      "image",
      "https://cdn.example.com/asset.png",
    );
  });

  it("progress callback updates the stream-store progressText", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "video",
      token: "tok",
      prompt: "x",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    const captured = calls[0].args as {
      onProgress: (p: { fraction?: number; message?: string }) => void;
    };
    setters.setProgressText.mockClear();
    captured.onProgress({ message: "Encoding frames…" });
    expect(setters.setProgressText).toHaveBeenCalledWith("Encoding frames…");
  });

  it("progress with only a fraction renders mode-aware percent text", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "image",
      token: "tok",
      prompt: "x",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    const captured = calls[0].args as {
      onProgress: (p: { fraction?: number; message?: string }) => void;
    };
    setters.setProgressText.mockClear();
    captured.onProgress({ fraction: 0.42 });
    const lastArgs =
      setters.setProgressText.mock.calls[
        setters.setProgressText.mock.calls.length - 1
      ];
    expect(lastArgs[0]).toContain("42%");
  });

  it("forwards limit frame turn_count to onLimit", () => {
    const setters = buildSetters();
    const onLimit = vi.fn();
    dispatchMediaTurn({
      mode: "image",
      token: "tok",
      prompt: "x",
      setters,
      onCompleted: vi.fn(),
      onLimit,
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    const captured = calls[0].args as { onLimit: (n: number) => void };
    captured.onLimit(2);
    expect(onLimit).toHaveBeenCalledWith(2);
  });

  it("forwards onError when the SSE client surfaces a typed error", () => {
    const setters = buildSetters();
    const onError = vi.fn();
    dispatchMediaTurn({
      mode: "video",
      token: "tok",
      prompt: "x",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError,
      onDone: vi.fn(),
    });
    const captured = calls[0].args as { onError: (e: Error) => void };
    captured.onError(new Error("upstream blew up"));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("ignores progress messages that are blank string and have no numeric fraction", () => {
    const setters = buildSetters();
    dispatchMediaTurn({
      mode: "image",
      token: "tok",
      prompt: "x",
      setters,
      onCompleted: vi.fn(),
      onLimit: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    });
    const captured = calls[0].args as {
      onProgress: (p: { fraction?: number; message?: string }) => void;
    };
    setters.setProgressText.mockClear();
    captured.onProgress({ message: "   " });
    expect(setters.setProgressText).not.toHaveBeenCalled();
  });
});
