import { useState } from "react";
import { Spinner } from "@cypher-asi/zui";
import { FadeInImage } from "../FadeInImage";
import styles from "./GeneratedImageFrame.module.css";

interface GeneratedImageFrameProps {
  src: string;
  alt?: string;
  /** Applied to the inner `<img>` so existing call-site sizing keeps working. */
  className?: string;
  loading?: "lazy" | "eager";
}

/**
 * Frame for a freshly generated image. Keeps a loader visible in a
 * reserved (square) box until the bitmap is fully decoded, then fades the
 * image in over it. Prevents the "image paints/grows progressively down the
 * page" symptom that happens when a bare `<img>` is mounted the moment the
 * generation stream completes but the file is still downloading.
 */
export function GeneratedImageFrame({
  src,
  alt,
  className,
  loading,
}: GeneratedImageFrameProps) {
  const [ready, setReady] = useState(false);
  // Reset readiness when the source changes (prop-derived state pattern).
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setReady(false);
  }

  return (
    <span
      className={`${styles.frame} ${ready ? styles.frameReady : ""}`}
      data-ready={ready}
    >
      {!ready && (
        <span className={styles.loader} aria-hidden="true">
          <Spinner size="sm" />
        </span>
      )}
      <FadeInImage
        src={src}
        alt={alt ?? ""}
        className={className}
        loading={loading}
        onReady={() => setReady(true)}
      />
    </span>
  );
}
