import styles from "./CookingIndicator.module.css";

interface CookingIndicatorProps {
  label?: string;
  hidden?: boolean;
  /**
   * Optional countdown string (e.g. `"0:42"`) rendered next to the
   * shimmering label. Used by the image-generation flow via
   * `useGenerationEta` so the user can see an estimate of how much
   * time is left while the upstream router renders the image.
   *
   * `null` / `undefined` / empty string leaves the indicator
   * rendering just the label, so callers can drop the slot once the
   * countdown overruns (the label itself swaps to `"Almost done…"`).
   */
  countdown?: string | null;
}

export function CookingIndicator({
  label = "Cooking...",
  hidden = false,
  countdown,
}: CookingIndicatorProps) {
  if (hidden) {
    return null;
  }

  return (
    <div className={styles.cookingIndicator}>
      <span className={styles.cookingText}>{label}</span>
      {countdown ? (
        <span className={styles.countdown} aria-label="Estimated time remaining">
          {countdown}
        </span>
      ) : null}
    </div>
  );
}
