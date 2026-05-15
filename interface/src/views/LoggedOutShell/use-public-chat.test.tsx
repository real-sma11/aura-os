/**
 * Phase 4 vitest for the `usePublicChat` orchestration hook. The
 * contract this file pins:
 *
 * - Mode dispatch routes to the right API call across all five
 *   modes (`code` → chat, `plan` → chat, `image` → media,
 *   `video` → media, `3d` → no-op for now because Tripo needs an
 *   image attachment).
 * - When the gate trips (`turnCount >= 3`), `handleSend`
 *   short-circuits and does not call any API.
 * - When a media stream completes, `commitMedia` lands the right
 *   discriminated-union variant in the store.
 *
 * The hook is exercised through `renderHook` with mocked
 * `streamPublicChat` and `dispatchMediaTurn` so we can synthesise
 * SSE callbacks inline. The chat-ui store and public-chat store
 * are the real implementations.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

interface MockedStreamPublicChatArgs {
  token: string;
  sessionId: string;
  history: unknown[];
  message: string;
  mode: "code" | "plan";
  onDelta: (text: string) => void;
  onLimit: (n: number) => void;
  onError: (err: Error) => void;
  onDone?: () => void;
}

interface MockedDispatchMediaArgs {
  mode: "image" | "video" | "model3d";
  token: string;
  prompt: string;
  sourceImage?: string;
  setters: unknown;
  onCompleted: (mode: "image" | "video" | "model3d", url: string) => void;
  onLimit: (n: number) => void;
  onError: (err: Error) => void;
  onDone: () => void;
}

const streamPublicChatMock = vi.fn();
const dispatchMediaTurnMock = vi.fn();
const ensureTokenMock = vi.fn();

vi.mock("../../api/public-chat", () => ({
  streamPublicChat: (args: MockedStreamPublicChatArgs) => {
    streamPublicChatMock(args);
    return { close: vi.fn() };
  },
}));

vi.mock("./dispatch-media", () => ({
  dispatchMediaTurn: (args: MockedDispatchMediaArgs) => {
    dispatchMediaTurnMock(args);
    return { close: vi.fn() };
  },
}));

// The interim Phase 4 auth gate routes anonymous sends to `/login`;
// these tests pin the per-mode dispatch contract that runs once the
// visitor IS authenticated, so the mock returns isAuthenticated=true
// to bypass the gate. The gate itself is exercised in
// `LoggedOutChatView.test.tsx`.
vi.mock("../../stores/auth-store", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

import { usePublicChat } from "./use-public-chat";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { useChatUIStore } from "../../stores/chat-ui-store";

function renderPublicChat(sessionId: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>{children}</MemoryRouter>
  );
  return renderHook(() => usePublicChat(sessionId), { wrapper });
}

beforeEach(() => {
  streamPublicChatMock.mockClear();
  dispatchMediaTurnMock.mockClear();
  ensureTokenMock.mockClear();
  window.localStorage.clear();
  // Reset the public-chat store to its zero state and seed a token
  // so `ensureToken` short-circuits.
  usePublicChatStore.setState({
    guestToken: "test-token",
    limit: 3,
    turnCount: 0,
    sessions: {},
    sessionOrder: [],
    setupInFlight: false,
  });
  // Reset the chat-ui store.
  useChatUIStore.setState({ streams: {}, drafts: {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

const SESSION_ID = "test-session";

describe("usePublicChat", () => {
  it("routes `code` mode through streamPublicChat", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    // selectedMode defaults to `code` (DEFAULT_AGENT_MODE)
    await act(async () => {
      await result.current.handleSend("hello world");
    });
    expect(streamPublicChatMock).toHaveBeenCalledTimes(1);
    expect(dispatchMediaTurnMock).not.toHaveBeenCalled();
    expect(streamPublicChatMock.mock.calls[0][0].mode).toBe("code");
    expect(streamPublicChatMock.mock.calls[0][0].message).toBe("hello world");
  });

  it("routes `plan` mode through streamPublicChat with mode=plan", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    act(() => {
      useChatUIStore
        .getState()
        .setSelectedMode(`public:${SESSION_ID}`, "plan");
    });
    await act(async () => {
      await result.current.handleSend("plan this");
    });
    expect(streamPublicChatMock).toHaveBeenCalledTimes(1);
    expect(streamPublicChatMock.mock.calls[0][0].mode).toBe("plan");
  });

  it("routes `image` mode through dispatchMediaTurn with mode=image", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    act(() => {
      useChatUIStore
        .getState()
        .setSelectedMode(`public:${SESSION_ID}`, "image");
    });
    await act(async () => {
      await result.current.handleSend("a kite");
    });
    expect(dispatchMediaTurnMock).toHaveBeenCalledTimes(1);
    expect(streamPublicChatMock).not.toHaveBeenCalled();
    expect(dispatchMediaTurnMock.mock.calls[0][0].mode).toBe("image");
    expect(dispatchMediaTurnMock.mock.calls[0][0].prompt).toBe("a kite");
  });

  it("routes `video` mode through dispatchMediaTurn with mode=video", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    act(() => {
      useChatUIStore
        .getState()
        .setSelectedMode(`public:${SESSION_ID}`, "video");
    });
    await act(async () => {
      await result.current.handleSend("a kite");
    });
    expect(dispatchMediaTurnMock).toHaveBeenCalledTimes(1);
    expect(dispatchMediaTurnMock.mock.calls[0][0].mode).toBe("video");
  });

  it("`3d` mode short-circuits (no API call) because Tripo needs a source image", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderPublicChat(SESSION_ID);
    act(() => {
      useChatUIStore.getState().setSelectedMode(`public:${SESSION_ID}`, "3d");
    });
    await act(async () => {
      await result.current.handleSend("turn this into a 3d model");
    });
    expect(streamPublicChatMock).not.toHaveBeenCalled();
    expect(dispatchMediaTurnMock).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("short-circuits send when the gate has tripped (turnCount >= limit)", async () => {
    usePublicChatStore.setState({ turnCount: 3 });
    const { result } = renderPublicChat(SESSION_ID);
    await act(async () => {
      await result.current.handleSend("blocked");
    });
    expect(streamPublicChatMock).not.toHaveBeenCalled();
    expect(dispatchMediaTurnMock).not.toHaveBeenCalled();
  });

  it("trims whitespace and bails on an empty message", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    await act(async () => {
      await result.current.handleSend("   ");
    });
    expect(streamPublicChatMock).not.toHaveBeenCalled();
    expect(dispatchMediaTurnMock).not.toHaveBeenCalled();
  });

  it("commits a media message with the right shape on completion", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    act(() => {
      useChatUIStore
        .getState()
        .setSelectedMode(`public:${SESSION_ID}`, "image");
    });
    await act(async () => {
      await result.current.handleSend("a kite");
    });
    expect(dispatchMediaTurnMock).toHaveBeenCalledTimes(1);
    const args = dispatchMediaTurnMock.mock.calls[0][0] as MockedDispatchMediaArgs;
    act(() => {
      args.onCompleted("image", "https://cdn.example.com/asset.png");
    });
    const session = usePublicChatStore.getState().sessions[SESSION_ID];
    expect(session).toBeDefined();
    // Last turn should be the assistant media message with the right
    // discriminated-union variant.
    const lastTurn = session?.turns[session.turns.length - 1];
    expect(lastTurn?.role).toBe("assistant");
    if (lastTurn?.role === "assistant" && lastTurn.mode === "image") {
      expect(lastTurn.url).toBe("https://cdn.example.com/asset.png");
      expect(lastTurn.prompt).toBe("a kite");
    } else {
      throw new Error(
        `expected an image assistant turn, got: ${JSON.stringify(lastTurn)}`,
      );
    }
  });

  it("forwards onLimit from the chat stream into setTurnCount", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    await act(async () => {
      await result.current.handleSend("hello");
    });
    expect(streamPublicChatMock).toHaveBeenCalledTimes(1);
    const args = streamPublicChatMock.mock.calls[0][0] as MockedStreamPublicChatArgs;
    act(() => {
      args.onLimit(2);
    });
    expect(usePublicChatStore.getState().turnCount).toBe(2);
  });

  it("returns shouldShowGate=true once turnCount has hit the limit", () => {
    usePublicChatStore.setState({ turnCount: 3 });
    const { result } = renderPublicChat(SESSION_ID);
    expect(result.current.shouldShowGate).toBe(true);
  });

  it("appends the user turn into the public-chat store before streaming", async () => {
    const { result } = renderPublicChat(SESSION_ID);
    await act(async () => {
      await result.current.handleSend("track me");
    });
    const session = usePublicChatStore.getState().sessions[SESSION_ID];
    expect(session).toBeDefined();
    expect(session?.turns[0]?.role).toBe("user");
    if (session?.turns[0].role === "user") {
      expect(session.turns[0].content).toBe("track me");
    }
  });
});
