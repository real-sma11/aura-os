import { useLayoutEffect, useRef, useState } from "react";
import styles from "./PersonaCard.module.css";

interface PersonaBlockProps {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * A single labelled block clamped to two lines. The "Show more" toggle
 * only appears when the value actually overflows the clamp, measured by
 * comparing the element's scroll height to its clipped client height.
 */
function PersonaBlock({ label, value, mono }: PersonaBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const valueRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    const measure = () => {
      // Only meaningful while clamped; the clamp keeps clientHeight at two
      // lines, so an overflowing scrollHeight reveals hidden content.
      if (expanded) return;
      setOverflows(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, expanded]);

  const valueClass = [
    styles.value,
    mono ? styles.valueMono : "",
    expanded ? "" : styles.clamped,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.block}>
      <span className={styles.label}>{label}</span>
      <p ref={valueRef} className={valueClass}>
        {value}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export interface PersonaCardProps {
  personality?: string;
  systemPrompt?: string;
}

/**
 * Wide black-glass card that carries the agent's persona: the Personality
 * and System Prompt blocks stacked vertically, each truncated to two
 * lines with a Show more / Show less toggle.
 */
export function PersonaCard({ personality, systemPrompt }: PersonaCardProps) {
  const hasPersonality = !!personality?.trim();
  const hasSystemPrompt = !!systemPrompt?.trim();

  if (!hasPersonality && !hasSystemPrompt) return null;

  return (
    <div className={styles.card}>
      {hasPersonality && (
        <PersonaBlock label="Personality" value={personality!} />
      )}
      {hasSystemPrompt && (
        <PersonaBlock label="System Prompt" value={systemPrompt!} mono />
      )}
    </div>
  );
}
