import styles from "./MediaGenerationPlaceholder.module.css";

type MediaKind = "image" | "video";

interface MediaGenerationPlaceholderProps {
  /** Drives the aspect ratio and the "Creating …" label. */
  kind: MediaKind;
  /**
   * Latest reported generation percent (0-100) when available. Renders a
   * subtle progress hint inside the frame; omit/`null` to just animate.
   */
  percent?: number | null;
}

const LABELS: Record<MediaKind, string> = {
  image: "Creating image",
  video: "Creating video",
};

/**
 * Sized placeholder shown in the chat lane while an image or video is being
 * generated. Reserves the media frame at the right aspect ratio (image 1:1,
 * video 16:9) so the real `ImageBlock` / `VideoBlock` lands without a layout
 * jump, and fills it with a continuously moving animated background so the
 * wait reads as active progress rather than a frozen box.
 */
export function MediaGenerationPlaceholder({
  kind,
  percent,
}: MediaGenerationPlaceholderProps) {
  const hasPercent =
    typeof percent === "number" && Number.isFinite(percent) && percent > 0;
  const clamped = hasPercent ? Math.min(100, Math.max(0, Math.round(percent!))) : null;

  return (
    <div
      className={`${styles.frame} ${kind === "video" ? styles.video : styles.image}`}
      role="status"
      aria-live="polite"
      aria-label={LABELS[kind]}
      data-agent-proof="media-generation-placeholder"
    >
      <div className={styles.motion} aria-hidden="true" />
      <div className={styles.overlay}>
        <span className={styles.label}>{LABELS[kind]}</span>
        {clamped !== null ? (
          <span className={styles.percent}>{clamped}%</span>
        ) : null}
      </div>
    </div>
  );
}
