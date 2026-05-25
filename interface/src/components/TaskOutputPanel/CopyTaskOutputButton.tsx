import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { Check, Copy } from "lucide-react";
import styles from "./TaskOutputPanel.module.css";

interface CopyTaskOutputButtonProps {
  getCopyText: () => string;
  /**
   * `header` renders a span with `role="button"` so the control can be
   * nested inside another `<button>` (the row's `taskHeader`) without
   * producing an invalid nested-button DOM. `stats` renders a regular
   * `<button>` for use in the GroupCollapsible's `stats` slot, which is
   * a sibling of the header button rather than a descendant.
   */
  variant?: "header" | "stats";
  title?: string;
}

const STATS_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  padding: "2px 8px",
  cursor: "pointer",
  fontSize: 10,
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
};

export function CopyTaskOutputButton({
  getCopyText,
  variant = "header",
  title = "Copy all output",
}: CopyTaskOutputButtonProps) {
  const [copied, setCopied] = useState(false);

  const runCopy = useCallback(
    async (event: SyntheticEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const text = getCopyText();
      if (!text) {
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* clipboard unavailable; swallow to match the existing CopyAllOutputButton */
      }
    },
    [getCopyText],
  );

  if (variant === "stats") {
    return (
      <button
        type="button"
        onClick={runCopy}
        title={title}
        aria-label={title}
        style={STATS_STYLE}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    );
  }

  const handleKey = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      void runCopy(event);
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={runCopy}
      onKeyDown={handleKey}
      title={title}
      aria-label={title}
      className={styles.copyBtn}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </span>
  );
}
