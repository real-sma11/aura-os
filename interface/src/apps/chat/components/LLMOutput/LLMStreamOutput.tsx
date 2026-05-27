import type { RefObject } from "react";
import type { ArtifactRef, ToolCallEntry, TimelineItem } from "../../../../shared/types/stream";
import { getStreamingPhaseLabel } from "../../../../utils/streaming";
import { CookingIndicator } from "../../../../components/CookingIndicator";
import { LLMOutput } from "./LLMOutput";

export interface LLMStreamOutputProps {
  isStreaming: boolean;
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  progressText?: string;
  artifactRefs?: ArtifactRef[];
  isWriting?: boolean;
  /**
   * When true (default) the inline phase indicator ("Cooking...", "Thinking...",
   * etc.) renders right below the streamed content. Chat contexts that pin the
   * indicator elsewhere pass `false` so it does not also appear inline and jitter
   * the scroll flow.
   */
  showPhaseIndicator?: boolean;
  /**
   * Forwarded to `LLMOutput` -> `ActivityTimeline`. When provided, the
   * activity timeline windows its rows against this scroll element via
   * `@tanstack/react-virtual`. Used by the task preview overlay.
   */
  scrollRef?: RefObject<HTMLElement | null>;
}

function StreamingIndicator({
  isStreaming,
  text,
  thinkingText,
  toolCalls,
  progressText,
  isWriting,
}: {
  isStreaming: boolean;
  text: string;
  thinkingText?: string;
  toolCalls?: ToolCallEntry[];
  progressText?: string;
  isWriting?: boolean;
}) {
  if (!isStreaming) return null;
  const label = getStreamingPhaseLabel({
    streamingText: text,
    thinkingText,
    toolCalls: toolCalls ?? [],
    progressText,
    isWriting,
  });
  return <CookingIndicator label={label ?? "Cooking..."} hidden={!label} />;
}

export function LLMStreamOutput({
  isStreaming,
  text,
  toolCalls,
  thinkingText,
  thinkingDurationMs,
  timeline,
  progressText,
  artifactRefs,
  isWriting,
  showPhaseIndicator = true,
  scrollRef,
}: LLMStreamOutputProps) {
  return (
    <>
      <LLMOutput
        content={text}
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText={thinkingText}
        thinkingDurationMs={thinkingDurationMs}
        artifactRefs={artifactRefs}
        isStreaming={isStreaming}
        scrollRef={scrollRef}
      />
      {showPhaseIndicator && (
        <StreamingIndicator
          isStreaming={isStreaming}
          text={text}
          thinkingText={thinkingText}
          toolCalls={toolCalls}
          progressText={progressText}
          isWriting={isWriting}
        />
      )}
    </>
  );
}
