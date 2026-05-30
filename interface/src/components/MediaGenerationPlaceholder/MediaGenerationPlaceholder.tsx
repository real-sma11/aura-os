import { useEffect, useRef } from "react";
import styles from "./MediaGenerationPlaceholder.module.css";

type MediaKind = "image" | "video";

/** Pixel gap between dot centers; matches the density of the old CSS tile. */
const DOT_SPACING = 18;
/** Dot radius bounds (CSS px) as the ripple crests and troughs pass through. */
const DOT_MIN_RADIUS = 0.6;
const DOT_MAX_RADIUS = 2.2;
/** Dot alpha bounds; peaks read brighter so the wave fronts stand out. */
const DOT_MIN_ALPHA = 0.15;
const DOT_MAX_ALPHA = 0.7;

function parseColor(raw: string, fallback: [number, number, number]): [number, number, number] {
  const match = raw.match(/(\d+(?:\.\d+)?)/g);
  if (match && match.length >= 3) {
    return [Number(match[0]), Number(match[1]), Number(match[2])];
  }
  if (raw.startsWith("#") && (raw.length === 7 || raw.length === 4)) {
    const hex =
      raw.length === 4
        ? raw
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        : raw.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return fallback;
}

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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // jsdom (test env) and unsupported contexts return null — skip animating.
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let cssWidth = 0;
    let cssHeight = 0;
    let dotRgb: [number, number, number] = [120, 120, 120];
    let accentRgb: [number, number, number] = [80, 200, 180];

    const readColors = () => {
      const cs = getComputedStyle(canvas);
      dotRgb = parseColor(
        cs.getPropertyValue("--color-text-muted").trim(),
        [120, 120, 120],
      );
      accentRgb = parseColor(
        cs.getPropertyValue("--color-accent").trim(),
        [80, 200, 180],
      );
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssWidth = rect.width;
      cssHeight = rect.height;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readColors();
    };

    // Ripple field: combine a few traveling sine waves so dots crest and dim
    // in flowing diagonal bands rather than panning uniformly.
    const draw = (timeMs: number) => {
      const t = timeMs / 1000;
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      const cols = Math.ceil(cssWidth / DOT_SPACING) + 1;
      const rows = Math.ceil(cssHeight / DOT_SPACING) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * DOT_SPACING;
          const y = r * DOT_SPACING;
          const phase =
            Math.sin(x * 0.045 + t * 1.1) +
            Math.sin(y * 0.05 + t * 0.85) +
            Math.sin((x + y) * 0.03 - t * 1.4);
          // Normalize phase (-3..3) into 0..1.
          const n = (phase + 3) / 6;
          const radius = DOT_MIN_RADIUS + n * (DOT_MAX_RADIUS - DOT_MIN_RADIUS);
          const alpha = DOT_MIN_ALPHA + n * (DOT_MAX_ALPHA - DOT_MIN_ALPHA);
          // Tint the brightest crests toward the accent color.
          const tint = Math.max(0, (n - 0.7) / 0.3);
          const cr = Math.round(dotRgb[0] + (accentRgb[0] - dotRgb[0]) * tint);
          const cg = Math.round(dotRgb[1] + (accentRgb[1] - dotRgb[1]) * tint);
          const cb = Math.round(dotRgb[2] + (accentRgb[2] - dotRgb[2]) * tint);
          ctx.beginPath();
          ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    let rafId = 0;
    let observer: ResizeObserver | null = null;

    resize();

    if (reduceMotion) {
      // Single static frame, no loop.
      draw(0);
    } else {
      const loop = (now: number) => {
        draw(now);
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        resize();
        if (reduceMotion) draw(0);
      });
      observer.observe(canvas);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      className={`${styles.frame} ${kind === "video" ? styles.video : styles.image}`}
      role="status"
      aria-live="polite"
      aria-label={LABELS[kind]}
      data-agent-proof="media-generation-placeholder"
    >
      <canvas ref={canvasRef} className={styles.motion} aria-hidden="true" />
      <div className={styles.overlay}>
        <span className={styles.label}>{LABELS[kind]}</span>
        {clamped !== null ? (
          <span className={styles.percent}>{clamped}%</span>
        ) : null}
      </div>
    </div>
  );
}
