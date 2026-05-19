/**
 * Orchestration hook for `LoggedOutChatView`. Separates the SSE
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
import { useAuth } from "../../stores/auth-store";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import { dispatchMediaTurn, type MediaDispatchMode } from "./dispatch-media";

/** Public-mode return shape consumed by `LoggedOutChatView`. */
export interface PublicChatController {
  streamKey: string;
  agentId: string;
  defaultModel: string;
  session: PublicSession | null;
  messages: DisplaySessionEvent[];
  shouldShowGate: boolean;
  isStreaming: boolean;
  handleSend: (content: string) => Promise<void>;
  handleStop: () => void;
  input: string;
  setInput: (next: string) => void;
  /** True when the visitor is anonymous and any send attempt will be
   *  routed to `/login` (interim gate while the public chat backend
   *  is unreliable — the surface still mounts so the visitor can
   *  browse the shell). */
  requiresLogin: boolean;
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
  const appendUserTurn = usePublicChatStore((s) => s.appendUserTurn);
  const appendAssistantToken = usePublicChatStore((s) => s.appendAssistantToken);
  const commitAssistant = usePublicChatStore((s) => s.commitAssistant);
  const commitMedia = usePublicChatStore((s) => s.commitMedia);
  const setTurnCount = usePublicChatStore((s) => s.setTurnCount);
  const session = usePublicChatStore((s) => selectSession(s, sessionId));
  const shouldShowGate = usePublicChatStore(selectShouldShowGate);
  const turnCount = usePublicChatStore((s) => s.turnCount);

  const { isAuthenticated } = useAuth();

  const chatUI = useChatUI(streamKey);
  const selectedMode = chatUI.selectedMode;

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const chatHandleRef = useRef<PublicChatStreamHandle | null>(null);
  const mediaHandleRef = useRef<PublicMediaStreamHandle | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const settersRef = useRef(createSetters(streamKey));

  useEffect(() => {
    ensureEntry(streamKey);
    settersRef.current = createSetters(streamKey);
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
    if (!session) return [];
    return session.turns.map((turn) => publicMessageToDisplayEvent(turn));
  }, [session]);

  const clearStreamState = useCallback(() => {
    settersRef.current.setIsStreaming(false);
    settersRef.current.setStreamingText("");
    settersRef.current.setProgressText("");
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
          handleStop();
        },
        onDone: () => {
          chatHandleRef.current = null;
          clearStreamState();
          finalizeAssistantTurn(mode);
        },
      });
    },
    [clearStreamState, finalizeAssistantTurn, handleStop, session, sessionId, setTurnCount],
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
          handleStop();
        },
        onDone: () => {
          mediaHandleRef.current = null;
          clearStreamState();
        },
      });
    },
    [clearStreamState, commitMedia, handleStop, sessionId, setTurnCount],
  );

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      if (shouldShowGate) return;
      const behavior = AGENT_MODE_DESCRIPTORS[selectedMode].behavior;
      if (behavior.kind === "generate_3d") {
        // Tripo needs a source image; the input bar's attachment
        // pipeline lands base64 data URLs in the message body — for
        // the public surface that's currently out of scope. Bail
        // visibly so the user understands instead of silently
        // swallowing the click.
        console.warn("public 3D mode requires a source image attachment");
        return;
      }
      try {
        const token = await ensureToken();
        const userId = appendUserTurn(sessionId, trimmed);
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
        }
      } catch (err) {
        console.error("public chat send failed", err);
        handleStop();
      }
    },
    [
      appendUserTurn,
      dispatchChatTurn,
      dispatchMedia,
      ensureToken,
      handleStop,
      selectedMode,
      sessionId,
      shouldShowGate,
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
    handleSend,
    handleStop,
    input,
    setInput,
    requiresLogin: !isAuthenticated,
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
 * `ChatMessageList` expects. Image messages produce an inline
 * `contentBlocks` image so the chat-ui's image-rendering code path
 * works unchanged; video / model3d messages fall back to a markdown
 * link because the message bubble has no native video / 3D
 * renderer (auth'd users get those through synthesised tool turns
 * the public surface does not produce).
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
        content: `**Generated video** — [open in new tab](${turn.url})`,
      };
    case "model3d":
      return {
        id: turn.id,
        clientId: turn.id,
        role: "assistant",
        content: `**Generated 3D model** — [open in new tab](${turn.url})`,
      };
  }
}

// Re-export AgentMode in this module path so future test files can
// avoid reaching across to the constants module just to spell the
// type; harmless and zero-cost.
export type { AgentMode };
