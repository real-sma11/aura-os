import type { HTMLAttributes, ReactNode } from "react";
import styles from "./GlassCard.module.css";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Render the soft white glow behind the card. Defaults to true. */
  glow?: boolean;
  className?: string;
}

/**
 * Floating glass card: rounded corners, black see-through blurred glass,
 * a subtle gradient rim, and a soft white glow behind it.
 *
 * The blur lives on an inner layer (`.glass`) so the card's rounded
 * `overflow: hidden` clips it. A `backdrop-filter` applied directly to the
 * card would otherwise be rendered to a square bounding box by Chromium and
 * square off the corners.
 */
export function GlassCard({ children, glow = true, className, ...rest }: GlassCardProps) {
  return (
    <div
      className={`${styles.card} ${glow ? styles.glow : ""} ${className ?? ""}`}
      {...rest}
    >
      <div className={styles.glass} aria-hidden="true" />
      <div className={styles.border} aria-hidden="true" />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
