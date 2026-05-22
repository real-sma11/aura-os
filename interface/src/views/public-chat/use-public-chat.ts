/**
 * Orchestration hook for `PublicChatView`. Separates the SSE
 * dispatch / streamStore wiring from the presentational view so the
 * view stays render-focused (rules-react > ARCHITECTURE).
 *
 * Phase 3: media modalities (Image / Video / 3D) join Code / Plan
 * on the dispatch path. The branch lives in `handleSend`; the
 * media SSE plumbing itself is in `dispatch-media.ts` so this file
 * stays under the rules-react ~200-line target.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  selectShouldShowGate,
  selectSession,
  usePublicChatStore,
} from "../../stores/public-chat-store";
import type {
  PublicAssistantMediaMessage,
  PublicMessage,
  PublicSession,
} from "../../stores/public-chat-store";
import {
  streamPublicChat,
  type PublicChatStreamHandle,
  type PublicChatTurn,
  type PublicMediaStreamHandle,
} from "../../api/public-chat";
import { createSetters, ensureEntry } from "../../hooks/stream/store";
import { AGENT_MODE_DESCRIPTORS, type AgentMode } from "../../constants/modes";
import { useChatUI } from "../../stores/chat-ui-store";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import { track } from "../../lib/analytics";
import { dispatchMediaTurn, type MediaDispatchMode } from "./dispatch-media";

/** Public-mode return shape consumed by `PublicChatView`. */
export interface PublicChatController {
  streamKey: string;
  agentId: string;
  defaultModel: string;
  session: PublicSession | null;
  messages: DisplaySessionEvent[];
  shouldShowGate: boolean;
  isStreaming: boolean;
  sourceImage: string | null;
  setSourceImage: (dataUrl: string | null) => void;
  handleSend: (content: string) => Promise<void>;
  handleStop: () => void;
  input: string;
  setInput: (next: string) => void;
}

const DEFAULT_PUBLIC_MODEL = "aura-gpt-5-4-mini";
const PUBLIC_AGENT_ID = "public-demo";

/**
 * Drives one public chat session: handles `ensureToken`, sends the
 * user turn, opens an SSE stream, fans deltas into both the public
 * store (for persistence) and the global stream store (so the
 * shared `ChatMessageList` renders the live response).
 */
export function usePublicChat(sessionId: string): PublicChatController {
  const streamKey = useMemo(() => `public:${sessionId}`, [sessionId]);
  const ensureToken = usePublicChatStore((s) => s.ensureToken);
  const invalidateToken = usePublicChatStore((s) => s.invalidateToken);
  const appendUserTurn = usePublicChatStore((s) => s.appendUserTurn);
  const appendAssistantToken = usePublicChatStore((s) => s.appendAssistantToken);
  const commitAssistant = usePublicChatStore((s) => s.commitAssistant);
  const commitMedia = usePublicChatStore((s) => s.commitMedia);
  const setTurnCount = usePublicChatStore((s) => s.setTurnCount);
  const session = usePublicChatStore((s) => selectSession(s, sessionId));
  const shouldShowGate = usePublicChatStore(selectShouldShowGate);
  const turnCount = usePublicChatStore((s) => s.turnCount);
  const limit = usePublicChatStore((s) => s.limit);

  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const chatUI = useChatUI(streamKey);
  const selectedMode = chatUI.selectedMode;

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorEvent, setErrorEvent] = useState<DisplaySessionEvent | null>(null);

  const chatHandleRef = useRef<PublicChatStreamHandle | null>(null);
  const mediaHandleRef = useRef<PublicMediaStreamHandle | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const settersRef = useRef(createSetters(streamKey));

  // Reset per-session state whenever the active session flips (the
  // sidebar's "+" button mints a fresh session and navigates, and
  // clicking another row also flips `sessionId`). Without this, the
  // input draft, in-flight SSE handles, streaming flag, and error
  // banner from the prior session leak forward — making the
  // destination look like the same chat the user just left, which
  // reads as "the + button didn't take me to a new chat screen". We
  // deliberately skip the very first run (initial mount, `sessionId`
  // already matches the streamKey) so the controller doesn't clobber
  // an in-progress send mid-mount.
  const previousStreamKeyRef = useRef<string | null>(null);
  useEffect(() => {
    ensureEntry(streamKey);
    settersRef.current = createSetters(streamKey);
    if (previousStreamKeyRef.current !== null && previousStreamKeyRef.current !== streamKey) {
      chatHandleRef.current?.close();
      chatHandleRef.current = null;
      mediaHandleRef.current?.close();
      mediaHandleRef.current = null;
      assistantIdRef.current = null;
      accumulatedTextRef.current = "";
      setInput("");
      setIsStreaming(false);
      setErrorEvent(null);
      setSourceImage(null);
    }
    previousStreamKeyRef.current = streamKey;
  }, [streamKey]);

  useEffect(() => {
    return () => {
      chatHandleRef.current?.close();
      mediaHandleRef.current?.close();
    };
  }, []);

  const finalizeAssistantTurn = useCallback(
    (mode: "code" | "plan") => {
      const text = accumulatedTextRef.current;
      const assistantId = assistantIdRef.current;
      if (assistantId && text) {
        // Push the fully-accumulated assistant turn as a single
        // entry. This intentionally happens at commit-time (not on
        // every delta) so the live streaming bubble — sourced from
        // `streamStore.streamingText` — and the persisted transcript
        // never both render the same partial text simultaneously.
        appendAssistantToken(sessionId, assistantId, text, mode);
        commitAssistant(sessionId, assistantId);
      }
      accumulatedTextRef.current = "";
      assistantIdRef.current = null;
    },
    [appendAssistantToken, commitAssistant, sessionId],
  );

  const messages = useMemo<DisplaySessionEvent[]>(() => {
    const turns = session
      ? session.turns.map((turn) => publicMessageToDisplayEvent(turn))
      : [];
    if (errorEvent) turns.push(errorEvent);
    return turns;
  }, [session, errorEvent]);

  const clearStreamState = useCallback(() => {
    settersRef.current.setIsStreaming(false);
    settersRef.current.setStreamingText("");
    settersRef.current.setProgressText("");
    settersRef.current.clearGeneration();
    setIsStreaming(false);
  }, []);

  const handleStop = useCallback(() => {
    chatHandleRef.current?.close();
    chatHandleRef.current = null;
    mediaHandleRef.current?.close();
    mediaHandleRef.current = null;
    clearStreamState();
    // Best-effort: chat dispatch is the only path that buffers
    // assistant text; media dispatch commits via `commitMedia` and
    // does not accumulate text.
    finalizeAssistantTurn("code");
  }, [clearStreamState, finalizeAssistantTurn]);

  const dispatchChatTurn = useCallback(
    (mode: "code" | "plan", trimmed: string, token: string, userId: string) => {
      const assistantId = `assistant-${userId}`;
      assistantIdRef.current = assistantId;
      accumulatedTextRef.current = "";
      const history = buildHistoryFromSession(session, userId);
      settersRef.current.setIsStreaming(true);
      settersRef.current.setStreamingText("");
      setIsStreaming(true);
      chatHandleRef.current = streamPublicChat({
        token,
        sessionId,
        history,
        message: trimmed,
        mode,
        onDelta: (text) => {
          accumulatedTextRef.current += text;
          settersRef.current.setStreamingText(
            (prev) => (typeof prev === "string" ? prev : "") + text,
          );
        },
        onLimit: (next) => setTurnCount(next),
        onError: (err) => {
          console.error("public chat stream error", err);
          const msg = err.message?.toLowerCase() ?? "";
          if (msg.includes("invalid guest token")) invalidateToken();
          if (msg.includes("limit_reached") || msg.includes("rate")) {
            setTurnCount(limit);
          }
          chatHandleRef.current = null;
          clearStreamState();
          finalizeAssistantTurn(mode);
          if (!msg.includes("limit_reached")) {
            setErrorEvent({
              id: `error-${Date.now()}`,
              role: "assistant",
              content: "",
              errorMessage: err.message || "Something went wrong. Please try again.",
              displayVariant: "streamDropped",
            });
          }
        },
        onDone: () => {
          chatHandleRef.current = null;
          clearStreamState();
          finalizeAssistantTurn(mode);
        },
      });
    },
    [clearStreamState, finalizeAssistantTurn, invalidateToken, limit, session, sessionId, setTurnCount],
  );

  const dispatchMedia = useCallback(
    (mode: MediaDispatchMode, prompt: string, token: string, sourceImage: string | undefined) => {
      setIsStreaming(true);
      mediaHandleRef.current = dispatchMediaTurn({
        mode,
        token,
        prompt,
        sourceImage,
        setters: settersRef.current,
        onCompleted: (resolvedMode, url) => {
          const message: PublicAssistantMediaMessage = {
            id: `assistant-${resolvedMode}-${Date.now()}`,
            role: "assistant",
            mode: resolvedMode,
            url,
            prompt,
          };
          commitMedia(sessionId, message);
        },
        onLimit: (next) => setTurnCount(next),
        onError: (err) => {
          console.error("public media stream error", err);
          const msg = err.message?.toLowerCase() ?? "";
          if (msg.includes("invalid guest token")) invalidateToken();
          if (msg.includes("limit_reached") || msg.includes("rate")) {
            setTurnCount(limit);
          }
          mediaHandleRef.current = null;
          clearStreamState();
          if (!msg.includes("limit_reached")) {
            setErrorEvent({
              id: `error-${Date.now()}`,
              role: "assistant",
              content: "",
              errorMessage: err.message || "Generation failed. Please try again.",
              displayVariant: "streamDropped",
            });
          }
        },
        onDone: () => {
          mediaHandleRef.current = null;
          clearStreamState();
        },
      });
    },
    [clearStreamState, commitMedia, invalidateToken, limit, sessionId, setTurnCount],
  );

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      const behavior = AGENT_MODE_DESCRIPTORS[selectedMode].behavior;
      // In 3D mode, the image is the primary input — prompt is optional.
      // In all other modes, text is required.
      const is3d = behavior.kind === "generate_3d";
      if (!trimmed && !(is3d && sourceImage)) return;
      if (shouldShowGate) return;
      if (is3d && !sourceImage) {
        // Tripo needs a source image — the user must attach one
        // before sending in 3D mode.
        return;
      }
      setErrorEvent(null);
      track("public_message_sent", { mode: selectedMode });
      try {
        const token = await ensureToken();
        const displayText = trimmed || (is3d ? "Generate 3D model" : "");
        const userId = appendUserTurn(sessionId, displayText);
        setInput("");
        if (behavior.kind === "chat" || behavior.kind === "chat_with_action") {
          dispatchChatTurn(selectedMode === "plan" ? "plan" : "code", trimmed, token, userId);
          return;
        }
        if (behavior.kind === "generate_image") {
          dispatchMedia("image", trimmed, token, undefined);
          return;
        }
        if (behavior.kind === "generate_video") {
          dispatchMedia("video", trimmed, token, undefined);
          return;
        }
        if (is3d) {
          dispatchMedia("model3d", displayText, token, sourceImage ?? undefined);
          setSourceImage(null);
        }
      } catch (err) {
        console.error("public chat send failed", err);
        clearStreamState();
        setErrorEvent({
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "",
          errorMessage: err instanceof Error ? err.message : "Something went wrong. Please try again.",
          displayVariant: "streamDropped",
        });
      }
    },
    [
      appendUserTurn,
      clearStreamState,
      dispatchChatTurn,
      dispatchMedia,
      ensureToken,
      selectedMode,
      sessionId,
      shouldShowGate,
      sourceImage,
    ],
  );

  return {
    streamKey,
    agentId: PUBLIC_AGENT_ID,
    defaultModel: DEFAULT_PUBLIC_MODEL,
    session,
    messages,
    shouldShowGate: shouldShowGate || turnCount >= 3,
    isStreaming,
    sourceImage,
    setSourceImage,
    handleSend,
    handleStop,
    input,
    setInput,
  };
}

/**
 * Build a wire-shaped history payload from the persisted session,
 * excluding the user message we just appended (which is sent as
 * `message` instead). Returns at most the prior turns the backend
 * needs to rebuild context. Media-mode assistant turns are
 * intentionally omitted from the history payload — the chat
 * endpoint only consumes text turns.
 */
function buildHistoryFromSession(
  session: PublicSession | null,
  excludeUserId: string,
): PublicChatTurn[] {
  if (!session) return [];
  const turns: PublicChatTurn[] = [];
  for (const turn of session.turns) {
    if (turn.role === "user" && turn.id === excludeUserId) continue;
    if (turn.role === "user") {
      turns.push({ role: "user", content: turn.content });
      continue;
    }
    if (turn.role === "assistant" && (turn.mode === "code" || turn.mode === "plan")) {
      turns.push({ role: "assistant", content: turn.content });
    }
  }
  return turns;
}

/**
 * Adapt a [`PublicMessage`] into the [`DisplaySessionEvent`] shape
 * `ChatMessageList` expects. All media modes (image, video, model3d)
 * produce `contentBlocks` entries so the shared `MessageBubble`
 * renders them inline (image gallery, `<video>` player, WebGLViewer).
 */
function publicMessageToDisplayEvent(turn: PublicMessage): DisplaySessionEvent {
  if (turn.role === "user") {
    return { id: turn.id, clientId: turn.id, role: "user", content: turn.content };
  }
  switch (turn.mode) {
    case "code":
    case "plan":
      return { id: turn.id, clientId: turn.id, role: "assistant", content: turn.content };
    case "image":
      return {
        id: turn.id,
        clientId: turn.id,
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "image", media_type: "image/png", data: "", source_url: turn.url },
        ],
      };
    case "video":
      return {
        id: turn.id,
        clientId: turn.id,
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "video", url: turn.url },
        ],
      };
    case "model3d":
      return {
        id: turn.id,
        clientId: turn.id,
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "model3d", url: turn.url },
        ],
      };
  }
}

// Re-export AgentMode in this module path so future test files can
// avoid reaching across to the constants module just to spell the
// type; harmless and zero-cost.
export type { AgentMode };
