import type {
  ToolCallEntry,
  TimelineItem,
  GenerationKind,
} from "../../../../shared/types/stream";
import { LLMStreamOutput } from "../LLMOutput";
import { MediaGenerationPlaceholder } from "../../../../components/MediaGenerationPlaceholder";
import styles from "../MessageBubble/MessageBubble.module.css";

interface StreamingBubbleProps {
  isStreaming: boolean;
  text: string;
  toolCalls?: ToolCallEntry[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
  progressText?: string;
  isWriting?: boolean;
  showPhaseIndicator?: boolean;
  /**
   * Kind of media being generated on this turn, when an image/video
   * generation stream is in flight. Drives the in-lane loading
   * placeholder so the media frame is reserved before the tool result
   * lands at completion.
   */
  generationKind?: GenerationKind | null;
  /** Latest reported generation percent, forwarded to the placeholder. */
  generationPercent?: number | null;
}

export function StreamingBubble({
  isStreaming,
  text,
  toolCalls,
  thinkingText,
  thinkingDurationMs,
  timeline,
  progressText,
  isWriting,
  showPhaseIndicator,
  generationKind,
  generationPercent,
}: StreamingBubbleProps) {
  const showMediaPlaceholder =
    generationKind === "image" || generationKind === "video";

  return (
    <div className={`${styles.message} ${styles.messageAssistant}`}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <LLMStreamOutput
          isStreaming={isStreaming}
          text={text}
          toolCalls={toolCalls}
          thinkingText={thinkingText}
          thinkingDurationMs={thinkingDurationMs}
          timeline={timeline}
          progressText={progressText}
          isWriting={isWriting}
          showPhaseIndicator={showPhaseIndicator}
        />
        {showMediaPlaceholder ? (
          <MediaGenerationPlaceholder
            kind={generationKind === "video" ? "video" : "image"}
            percent={generationPercent}
          />
        ) : null}
      </div>
    </div>
  );
}
