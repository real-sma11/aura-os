import { memo } from "react";
import { Check } from "lucide-react";
import type { CouncilMechanism } from "../../stores/chat-ui-store";
import styles from "./InputBarShell.module.css";

export interface CouncilMechanismRowProps {
  /** Current combine mechanism. */
  mechanism: CouncilMechanism;
  /** Select a new combine mechanism. */
  onSelect: (mechanism: CouncilMechanism) => void;
}

interface MechanismOption {
  value: CouncilMechanism;
  label: string;
  hint: string;
}

// `members[0]` applies the chosen mechanism once every member finishes.
const COUNCIL_MECHANISMS: MechanismOption[] = [
  { value: "synthesize", label: "Synthesize", hint: "one combined answer" },
  { value: "contrast", label: "Contrast", hint: "agreements vs differences" },
  { value: "side_by_side", label: "Side-by-side", hint: "each answer, separate" },
];

/**
 * AURA Council combine-mechanism picker. Rendered directly in the model
 * menu (under the {@link import("./CouncilCountRow").CouncilCountRow})
 * whenever the council is active, so the three options are always
 * visible with a clear active checkmark — unlike a nested hover flyout,
 * a single click selects and the active row updates in place.
 */
export const CouncilMechanismRow = memo(function CouncilMechanismRow({
  mechanism,
  onSelect,
}: CouncilMechanismRowProps) {
  return (
    <div
      className={styles.councilMechanismSection}
      data-agent-surface="council-mechanism"
    >
      <div className={styles.councilMechanismHeader}>Combine results</div>
      {COUNCIL_MECHANISMS.map((option) => {
        const selected = option.value === mechanism;
        return (
          <button
            key={option.value}
            type="button"
            className={`${styles.modelMenuItem} ${selected ? styles.modelMenuItemActive : ""}`}
            data-council-mechanism-option={option.value}
            aria-pressed={selected}
            onClick={() => onSelect(option.value)}
          >
            <span className={styles.councilCountLabel}>
              <span className={styles.modelMenuItemLabel}>{option.label}</span>
              <span className={styles.councilCountHint}>{option.hint}</span>
            </span>
            <span className={styles.modelMenuItemMeta}>
              {selected ? (
                <Check size={13} className={styles.modelMenuItemChevron} />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
});
