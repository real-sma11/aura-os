import { Brain } from "lucide-react";
import { Block } from "./Block";
import { stripEmojis } from "../../shared/utils/text-normalize";
import { formatDuration } from "../../shared/utils/format";
import styles from "./ThinkingBlock.module.css";

interface ThinkingBlockProps {
  text: string;
  isStreaming: boolean;
  durationMs?: number | null;
  defaultExpanded?: boolean;
}

export function ThinkingBlock({
  text,
  isStreaming,
  durationMs,
  defaultExpanded,
}: ThinkingBlockProps) {
  const title = isStreaming
    ? "Thinking..."
    : durationMs != null
      ? `Thought for ${formatDuration(durationMs)}`
      : "Thought";

  const titleNode = (
    <span className={isStreaming ? styles.thinkingLabelShimmer : ""}>
      {title}
    </span>
  );

  // When there's no thinking text yet (synthetic streaming placeholder, or
  // an open segment whose first delta hasn't arrived) the body would
  // otherwise paint an empty padded viewport bracketed by its own
  // `border-top` and the block shell's bottom border — visually a "double
  // line" beneath the header. Render the header on its own instead so
  // the shimmering "Thinking..." label is the entire UI until content
  // shows up. Once text arrives, the block expands by default while
  // streaming but remains user-collapsible (no `forceExpanded` lock).
  const cleanText = stripEmojis(text);

  if (!cleanText) {
    return (
      <Block
        className={`${styles.thinkingBlock} ${isStreaming ? styles.thinkingBlockStreaming : ""}`}
        icon={<Brain size={12} />}
        title={titleNode}
        status={isStreaming ? "pending" : "done"}
        headerOnly
        copy={{
          getText: () => title,
          ariaLabel: "Copy thinking",
        }}
      >
        {null}
      </Block>
    );
  }

  return (
    <Block
      className={`${styles.thinkingBlock} ${isStreaming ? styles.thinkingBlockStreaming : ""}`}
      icon={<Brain size={12} />}
      title={titleNode}
      status={isStreaming ? "pending" : "done"}
      defaultExpanded={defaultExpanded ?? isStreaming}
      autoScroll={isStreaming}
      copy={{
        getText: () => cleanText,
        ariaLabel: "Copy thinking",
      }}
    >
      <div className={styles.thinkingText}>{cleanText}</div>
    </Block>
  );
}
