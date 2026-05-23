import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@cypher-asi/zui";
import {
  useDesktopBackgroundStore,
  type BackgroundConfig,
} from "../../stores/desktop-background-store";
import styles from "./DesktopShell.module.css";

function configKey(c: BackgroundConfig): string {
  if (c.mode === "color") return `color:${c.color}`;
  if (c.mode === "image") return `image:${c.imageDataUrl}`;
  return "none";
}

function isRenderable(c: BackgroundConfig): boolean {
  if (c.mode === "color") return c.color.length > 0;
  if (c.mode === "image") return c.imageDataUrl.length > 0;
  return false;
}

function styleFor(c: BackgroundConfig): CSSProperties | null {
  if (c.mode === "color") return { backgroundColor: c.color };
  if (c.mode === "image") {
    return {
      backgroundImage: `url(${c.imageDataUrl})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Preloads (decodes) an image data URL before resolving. Resolves even on
 * failure so a broken/aborted decode never strands the crossfade.
 */
function decodeImage(dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve();
      return;
    }
    const img = new Image();
    img.src = dataUrl;
    const done = () => resolve();
    if (typeof img.decode === "function") {
      img.decode().then(done, done);
      return;
    }
    img.onload = done;
    img.onerror = done;
  });
}

export function BackgroundLayer() {
  const light = useDesktopBackgroundStore((s) => s.light);
  const dark = useDesktopBackgroundStore((s) => s.dark);
  const hydrated = useDesktopBackgroundStore((s) => s.hydrated);
  const { resolvedTheme } = useTheme();

  const active: BackgroundConfig = resolvedTheme === "light" ? light : dark;

  const [current, setCurrent] = useState<BackgroundConfig | null>(null);
  const [incoming, setIncoming] = useState<BackgroundConfig | null>(null);
  const [incomingActive, setIncomingActive] = useState(false);
  const tokenRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (current && configKey(current) === configKey(active)) return;
    if (incoming && configKey(incoming) === configKey(active)) return;

    const token = ++tokenRef.current;

    const apply = (cfg: BackgroundConfig) => {
      if (tokenRef.current !== token) return;
      const skipFade = current === null || prefersReducedMotion();
      if (skipFade) {
        setCurrent(cfg);
        setIncoming(null);
        setIncomingActive(false);
        return;
      }
      setIncoming(cfg);
      setIncomingActive(false);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          if (tokenRef.current !== token) return;
          setIncomingActive(true);
        });
      });
    };

    if (active.mode === "image" && active.imageDataUrl) {
      decodeImage(active.imageDataUrl).then(() => apply(active));
    } else {
      apply(active);
    }
  }, [active, hydrated, current, incoming]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleTransitionEnd = (
    e: React.TransitionEvent<HTMLDivElement>,
  ) => {
    if (e.propertyName !== "opacity") return;
    if (!incoming) return;
    setCurrent(incoming);
    setIncoming(null);
    setIncomingActive(false);
  };

  if (!hydrated) return null;

  const currentRenderable = current && isRenderable(current) ? current : null;
  const incomingRenderable = incoming && isRenderable(incoming) ? incoming : null;

  if (!currentRenderable && !incomingRenderable) return null;

  return (
    <div className={styles.backgroundLayer} data-testid="background-layer">
      {currentRenderable && (
        <div
          className={`${styles.bgFadeBase} ${styles.bgFadeCurrent}`}
          style={styleFor(currentRenderable) ?? undefined}
          data-role="current"
          data-bg-key={configKey(currentRenderable)}
        />
      )}
      {incomingRenderable && (
        <div
          key={configKey(incomingRenderable)}
          className={`${styles.bgFadeBase} ${
            incomingActive ? styles.bgFadeIncomingActive : styles.bgFadeIncomingEnter
          }`}
          style={styleFor(incomingRenderable) ?? undefined}
          data-role="incoming"
          data-bg-key={configKey(incomingRenderable)}
          onTransitionEnd={handleTransitionEnd}
        />
      )}
    </div>
  );
}
