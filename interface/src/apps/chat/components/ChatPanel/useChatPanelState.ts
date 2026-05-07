import { useState, useRef, useEffect, useCallback } from "react";
import { useScrollAnchorV2 } from "../../../../shared/hooks/use-scroll-anchor-v2";
import { useIsStreaming } from "../../../../hooks/stream/hooks";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import type { ChatInputBarHandle, AttachmentItem } from "../ChatInputBar";
import { useMessageQueueStore, useMessageQueue } from "../../../../stores/message-queue-store";
import type { QueuedMessage } from "../../../../stores/message-queue-store";
import type { ChatAttachment } from "../../../../api/streams";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { isGenerationCommand, type SlashCommand } from "../../../../constants/commands";
import type { GenerationMode } from "../../../../constants/models";
import { availableModelsForAdapter } from "../../../../constants/models";
import { useChatUI } from "../../../../stores/chat-ui-store";
import { useConversationSnapshot } from "../../../../hooks/use-conversation-snapshot";
import { useLoadOlderMessages } from "../../../../hooks/use-load-older-messages";
import { useChatViewStore, useThreadView } from "../../../../stores/chat-view-store";
import {
  dispatch as dispatchResolvedSend,
  resolveSend,
  toQueuedRecord,
  type LegacyOnSend,
} from "./resolve-send";

// Stable module-level empty defaults. Reusing the same array references on
// every reset (rather than allocating a fresh `[]`) lets `React.memo` on the
// chat input bar skip re-renders when only the active session changes — the
// session reset effect would otherwise hand the bar a brand-new `attachments`
// / `selectedCommands` array each time and defeat the shallow prop compare.
const EMPTY_ATTACHMENTS: AttachmentItem[] = [];
const EMPTY_COMMANDS: SlashCommand[] = [];

export interface UseChatPanelStateOptions {
  streamKey: string;
  transcriptKey?: string;
  onSend: (
    content: string,
    action: string | null,
    selectedModel: string | null,
    attachments?: ChatAttachment[],
    commands?: string[],
    projectId?: string,
    generationMode?: GenerationMode,
    sourceImageUrl?: string,
  ) => void;
  adapterType?: string;
  defaultModel?: string | null;
  scrollResetKey?: unknown;
  scrollToBottomOnReset?: boolean;
  historyMessages?: DisplaySessionEvent[];
  selectedProjectId?: string;
  agentId?: string;
}

export function useChatPanelState({
  streamKey,
  transcriptKey,
  onSend,
  adapterType,
  defaultModel,
  scrollResetKey,
  scrollToBottomOnReset,
  historyMessages,
  selectedProjectId,
  agentId,
}: UseChatPanelStateOptions) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>(EMPTY_ATTACHMENTS);
  const [commands, setCommands] = useState<SlashCommand[]>(EMPTY_COMMANDS);
  const availableModels = availableModelsForAdapter(adapterType);
  const chatUI = useChatUI(streamKey);
  const selectedModel = chatUI.selectedModel;
  const selectedMode = chatUI.selectedMode;
  const messageAreaRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<ChatInputBarHandle>(null);
  const { isMobileLayout } = useAuraCapabilities();
  const attachmentsRef = useRef(attachments);
  const effectiveTranscriptKey = transcriptKey ?? streamKey;
  const { messages } = useConversationSnapshot({
    streamKey,
    transcriptKey: effectiveTranscriptKey,
    historyMessages,
  });
  const isStreaming = useIsStreaming(streamKey);
  const queue = useMessageQueue(streamKey);

  useEffect(() => {
    chatUI.init(streamKey, adapterType, defaultModel, agentId);
  }, [streamKey, adapterType, defaultModel, agentId, chatUI.init]);

  const resetKeyMountRef = useRef(true);
  useEffect(() => {
    if (resetKeyMountRef.current) {
      resetKeyMountRef.current = false;
      return;
    }
    // Bail out of the reset writes when the state is already empty so React
    // skips the re-render entirely. Combined with the module-level
    // `EMPTY_*` constants below, this lets the input bar's `React.memo`
    // shallow-compare see identical `attachments` / `selectedCommands`
    // refs across same-agent session switches.
    setInput((prev) => (prev === "" ? prev : ""));
    setAttachments((prev) => (prev.length === 0 ? prev : EMPTY_ATTACHMENTS));
    setCommands((prev) => (prev.length === 0 ? prev : EMPTY_COMMANDS));
  }, [scrollResetKey]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const { handleScroll, scrollToBottom, isAutoFollowing, getUserUnpinnedAt } =
    useScrollAnchorV2(messageAreaRef, {
      resetKey: scrollResetKey,
      scrollToBottomOnReset,
    });

  const { loadOlder, isLoadingOlder, hasOlderMessages } = useLoadOlderMessages({
    threadKey: effectiveTranscriptKey,
    agentId,
  });

  const threadView = useThreadView(streamKey);
  const unreadCount = threadView.unreadCount;

  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length > prevCount && !isAutoFollowing) {
      const newCount = messages.length - prevCount;
      for (let i = 0; i < newCount; i++) {
        useChatViewStore.getState().incrementUnread(streamKey);
      }
    }
  }, [messages.length, isAutoFollowing, streamKey]);

  useEffect(() => {
    if (isAutoFollowing) {
      useChatViewStore.getState().resetUnread(streamKey);
    }
  }, [isAutoFollowing, streamKey]);

  useEffect(() => {
    chatUI.syncAvailableModels(streamKey, adapterType, defaultModel, agentId);
  }, [
    adapterType,
    defaultModel,
    availableModels,
    chatUI.syncAvailableModels,
    streamKey,
    agentId,
  ]);

  const handleRemoveAttachment = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  const buildApiAttachments = useCallback(
    (atts?: AttachmentItem[]): ChatAttachment[] | undefined => {
      const toSend = atts ?? attachmentsRef.current;
      return toSend.length > 0
        ? toSend.map((a) => ({
            type: a.attachmentType,
            media_type: a.mediaType,
            data: a.fileUrl ? "" : a.data,
            name: a.name,
            source_url: a.fileUrl,
          }))
        : undefined;
    },
    [],
  );

  // Ref-mirror every value `handleSend` reads that's *not* `streamKey`.
  // Without this, `handleSend`'s identity churned on every selectedModel /
  // selectedMode / pinnedSourceImage / isStreaming / commands change and
  // cascaded into `<DesktopChatInputBar onSend={handleSend} />`, defeating
  // its `React.memo` whenever the user clicked between sessions of the
  // same agent. Identity is now stable per `streamKey`, which itself only
  // changes when the user switches agent (see `useStreamCore`).
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  const selectedModelRef = useRef(selectedModel);
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const selectedModeRef = useRef(selectedMode);
  useEffect(() => {
    selectedModeRef.current = selectedMode;
  }, [selectedMode]);

  const pinnedSourceImageRef = useRef(chatUI.pinnedSourceImage);
  useEffect(() => {
    pinnedSourceImageRef.current = chatUI.pinnedSourceImage;
  }, [chatUI.pinnedSourceImage]);

  const commandsRef = useRef(commands);
  useEffect(() => {
    commandsRef.current = commands;
  }, [commands]);

  const isStreamingRef = useRef(isStreaming);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const scrollToBottomRef = useRef(scrollToBottom);
  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom]);

  const handleSend = useCallback(
    (
      content: string,
      action?: string,
      atts?: AttachmentItem[],
      // genMode is accepted for backwards compatibility with callers
      // that still thread it explicitly (e.g. the unit tests). When
      // present, it overrides the store-derived mode for this single
      // send only — the store remains the persistent source of truth.
      genMode?: GenerationMode,
    ) => {
      setInput("");
      const apiAttachments = buildApiAttachments(atts) ?? [];
      const userCommandIds = commandsRef.current.map((c) => c.id);

      // Translate the active mode (with optional per-call override)
      // into a fully-typed `ResolvedSend` variant.
      const overrideMode =
        genMode === "image"
          ? ("image" as const)
          : genMode === "3d"
            ? ("3d" as const)
            : undefined;
      const effectiveAgentMode = overrideMode ?? selectedModeRef.current;

      // Read the pinned source image straight from the chat-ui store
      // so the request reflects exactly what the input bar's thumb
      // shows, and ignores any image that may have landed in the
      // chat history after the user removed the pin.
      const pinnedSourceImageUrl =
        pinnedSourceImageRef.current?.imageUrl ?? null;

      const resolved = resolveSend({
        mode: effectiveAgentMode,
        content,
        selectedModel: selectedModelRef.current,
        attachments: apiAttachments,
        userCommandIds,
        pinnedSourceImageUrl,
      });

      // Reset to module-level empties when not already empty, so React
      // sees a stable reference and the input bar's memo can short-circuit.
      setAttachments((prev) =>
        prev.length === 0 ? prev : EMPTY_ATTACHMENTS,
      );
      // Drop non-generation chips (the panel's transient chip row);
      // generation modes own that signal via the selector now.
      setCommands((prev) => {
        const next = prev.filter((c) => isGenerationCommand(c.id));
        if (next.length === prev.length) return prev;
        return next.length === 0 ? EMPTY_COMMANDS : next;
      });

      // An explicit `action` from the caller (e.g. inline "Generate
      // specs" buttons) wins over the mode-supplied one. The override
      // is applied at the wire boundary, not by mutating a variant,
      // so the discriminated union stays honest.
      const overrideAction: string | null = action ?? null;

      if (isStreamingRef.current) {
        const record = toQueuedRecord(resolved);
        useMessageQueueStore.getState().enqueue(streamKey, {
          content: record.content,
          action: overrideAction ?? record.action,
          model: record.model,
          attachments: record.attachments,
          commands: record.commands,
          generationMode: record.generationMode,
          sourceImageUrl: record.sourceImageUrl,
        });
        scrollToBottomRef.current();
      } else {
        scrollToBottomRef.current();
        if (overrideAction !== null) {
          // Caller supplied an explicit action; bypass the mode's
          // action and pass everything else through unchanged.
          const record = toQueuedRecord(resolved);
          (onSendRef.current as LegacyOnSend)(
            record.content,
            overrideAction,
            record.model,
            record.attachments,
            record.commands,
            selectedProjectIdRef.current,
            record.generationMode,
            record.sourceImageUrl,
          );
        } else {
          dispatchResolvedSend(
            resolved,
            onSendRef.current as LegacyOnSend,
            selectedProjectIdRef.current,
          );
        }
      }
    },
    [buildApiAttachments, streamKey],
  );

  const prevStreamingRef = useRef(false);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const next = useMessageQueueStore.getState().dequeue(streamKey);
      if (next) {
        onSendRef.current(
          next.content,
          next.action,
          next.model ?? selectedModelRef.current,
          next.attachments,
          next.commands,
          selectedProjectIdRef.current,
          next.generationMode,
          next.sourceImageUrl,
        );
        scrollToBottomRef.current();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [adapterType, isStreaming, streamKey]);

  const handleQueueEdit = useCallback(
    (item: QueuedMessage) => {
      useMessageQueueStore.getState().remove(streamKey, item.id);
      setInput(item.content);
      requestAnimationFrame(() => inputBarRef.current?.focus());
    },
    [streamKey],
  );

  const handleQueueMoveUp = useCallback(
    (id: string) => useMessageQueueStore.getState().moveUp(streamKey, id),
    [streamKey],
  );

  const handleQueueRemove = useCallback(
    (id: string) => useMessageQueueStore.getState().remove(streamKey, id),
    [streamKey],
  );

  return {
    input,
    setInput,
    attachments,
    setAttachments,
    commands,
    setCommands,
    messageAreaRef,
    inputBarRef,
    isMobileLayout,
    handleScroll,
    isAutoFollowing,
    getUserUnpinnedAt,
    isStreaming,
    queue,
    messages,
    scrollToBottom,
    handleRemoveAttachment,
    handleSend,
    handleQueueEdit,
    handleQueueMoveUp,
    handleQueueRemove,
    loadOlder,
    isLoadingOlder,
    hasOlderMessages,
    unreadCount,
  };
}
