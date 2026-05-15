/**
 * Orchestration hook for `LoggedOutChatView`. Separates the SSE
 * dispatch / streamStore wiring from the presentational view so the
 * view stays render-focused (rules-react > ARCHITECTURE).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  selectShouldShowGate,
  selectSession,
  usePublicChatStore,
} from "../../stores/public-chat-store";
import type { PublicMessage, PublicSession } from "../../stores/public-chat-store";
import {
  streamPublicChat,
  type PublicChatStreamHandle,
  type PublicChatTurn,
} from "../../api/public-chat";
import { createSetters, ensureEntry } from "../../hooks/stream/store";
import { AGENT_MODE_DESCRIPTORS, type AgentMode } from "../../constants/modes";
import { useChatUI } from "../../stores/chat-ui-store";
import type { DisplaySessionEvent } from "../../shared/types/stream";

/** Public-mode return shape consumed by `LoggedOutChatView`. */
export interface PublicChatController {
  streamKey: string;
  agentId: string;
  defaultModel: string;
  session: PublicSession | null;
  messages: DisplaySessionEvent[];
  shouldShowGate: boolean;
  isStreaming: boolean;
  comingSoonMessage: string | null;
  dismissComingSoon: () => void;
  handleSend: (content: string) => Promise<void>;
  handleStop: () => void;
  input: string;
  setInput: (next: string) => void;
}

const DEFAULT_PUBLIC_MODEL = "aura-gpt-5-4-mini";
const PUBLIC_AGENT_ID = "public-demo";

const COMING_SOON_COPY: Record<
  Exclude<AgentMode, "code" | "plan">,
  string
> = {
  image: "Image generation is coming soon — sign up for early access.",
  video: "Video generation is coming soon — sign up for early access.",
  "3d": "3D generation is coming soon — sign up for early access.",
} as const;

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
  const setTurnCount = usePublicChatStore((s) => s.setTurnCount);
  const session = usePublicChatStore((s) => selectSession(s, sessionId));
  const shouldShowGate = usePublicChatStore(selectShouldShowGate);
  const turnCount = usePublicChatStore((s) => s.turnCount);

  const chatUI = useChatUI(streamKey);
  const selectedMode = chatUI.selectedMode;

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [comingSoonMessage, setComingSoonMessage] = useState<string | null>(null);

  const handleRef = useRef<PublicChatStreamHandle | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const accumulatedTextRef = useRef<string>("");
  const settersRef = useRef(createSetters(streamKey));

  useEffect(() => {
    ensureEntry(streamKey);
    settersRef.current = createSetters(streamKey);
  }, [streamKey]);

  useEffect(() => {
    return () => {
      handleRef.current?.close();
    };
  }, []);

  const finalizeAssistantTurn = useCallback(() => {
    const text = accumulatedTextRef.current;
    const assistantId = assistantIdRef.current;
    if (assistantId && text) {
      // Push the fully-accumulated assistant turn as a single
      // entry. This intentionally happens at commit-time (not on
      // every delta) so the live streaming bubble — sourced from
      // `streamStore.streamingText` — and the persisted transcript
      // never both render the same partial text simultaneously.
      appendAssistantToken(sessionId, assistantId, text);
      commitAssistant(sessionId, assistantId);
    }
    accumulatedTextRef.current = "";
    assistantIdRef.current = null;
  }, [appendAssistantToken, commitAssistant, sessionId]);

  const messages = useMemo<DisplaySessionEvent[]>(() => {
    if (!session) return [];
    return session.turns.map((turn) => publicMessageToDisplayEvent(turn));
  }, [session]);

  const handleStop = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
    settersRef.current.setIsStreaming(false);
    settersRef.current.setStreamingText("");
    setIsStreaming(false);
    finalizeAssistantTurn();
  }, [finalizeAssistantTurn]);

  const handleSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      if (shouldShowGate) return;
      const behavior = AGENT_MODE_DESCRIPTORS[selectedMode].behavior;
      if (behavior.kind !== "chat" && behavior.kind !== "chat_with_action") {
        const key = selectedMode as Exclude<AgentMode, "code" | "plan">;
        setComingSoonMessage(COMING_SOON_COPY[key] ?? "Coming soon");
        return;
      }
      try {
        setComingSoonMessage(null);
        const token = await ensureToken();
        const userId = appendUserTurn(sessionId, trimmed);
        setInput("");
        const assistantId = `assistant-${userId}`;
        assistantIdRef.current = assistantId;
        accumulatedTextRef.current = "";

        const history = buildHistoryFromSession(session, userId);
        settersRef.current.setIsStreaming(true);
        settersRef.current.setStreamingText("");
        setIsStreaming(true);

        handleRef.current = streamPublicChat({
          token,
          sessionId,
          history,
          message: trimmed,
          mode: selectedMode === "plan" ? "plan" : "code",
          onDelta: (text) => {
            accumulatedTextRef.current += text;
            settersRef.current.setStreamingText(
              (prev) => (typeof prev === "string" ? prev : "") + text,
            );
          },
          onLimit: (next) => {
            setTurnCount(next);
          },
          onError: (err) => {
            console.error("public chat stream error", err);
            handleStop();
          },
          onDone: () => {
            handleRef.current = null;
            settersRef.current.setIsStreaming(false);
            settersRef.current.setStreamingText("");
            setIsStreaming(false);
            finalizeAssistantTurn();
          },
        });
      } catch (err) {
        console.error("public chat send failed", err);
        handleStop();
      }
    },
    [
      appendUserTurn,
      ensureToken,
      finalizeAssistantTurn,
      handleStop,
      selectedMode,
      session,
      sessionId,
      setTurnCount,
      shouldShowGate,
    ],
  );

  const dismissComingSoon = useCallback(() => setComingSoonMessage(null), []);

  return {
    streamKey,
    agentId: PUBLIC_AGENT_ID,
    defaultModel: DEFAULT_PUBLIC_MODEL,
    session,
    messages,
    shouldShowGate: shouldShowGate || turnCount >= 3,
    isStreaming,
    comingSoonMessage,
    dismissComingSoon,
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
 * needs to rebuild context.
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
    } else if (turn.role === "assistant") {
      turns.push({ role: "assistant", content: turn.content });
    }
  }
  return turns;
}

function publicMessageToDisplayEvent(turn: PublicMessage): DisplaySessionEvent {
  return {
    id: turn.id,
    clientId: turn.id,
    role: turn.role,
    content: turn.content,
  };
}
