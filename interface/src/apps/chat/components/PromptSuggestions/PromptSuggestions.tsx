import { BookOpen, Bot, HelpCircle, Lightbulb, type LucideIcon } from "lucide-react";
import styles from "./PromptSuggestions.module.css";

interface Suggestion {
  label: string;
  Icon: LucideIcon;
}

const SUGGESTIONS: Suggestion[] = [
  { label: "What can you help me with?", Icon: HelpCircle },
  { label: "Write me a short story", Icon: BookOpen },
  { label: "Explain how AI agents work", Icon: Bot },
  { label: "Help me brainstorm ideas", Icon: Lightbulb },
];

interface Props {
  onSelect: (prompt: string) => void;
}

export function PromptSuggestions({ onSelect }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.row}>
        {SUGGESTIONS.map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            className={styles.chip}
            onClick={() => onSelect(label)}
          >
            <Icon size={14} className={styles.chipIcon} aria-hidden />
            <span className={styles.chipLabel}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
