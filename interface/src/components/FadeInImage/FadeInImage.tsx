import { useState } from "react";
import styles from "./FadeInImage.module.css";

type FadeInImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  /**
   * Fired once the image is ready to show (decoded, or already-complete
   * cached). Lets a caller keep a loader visible until the bitmap is fully
   * ready rather than guessing from the stream lifecycle.
   */
  onReady?: () => void;
};

/**
 * Drop-in replacement for `<img>` that fades in once the browser has
 * decoded the image. Already-decoded (cached) images skip the fade by
 * checking `img.complete && img.naturalWidth > 0` on the ref callback,
 * so re-rendered or re-opened images don't flicker.
 * `prefers-reduced-motion` disables the transition entirely.
 *
 * The reveal is gated on `img.decode()` (when available) so the bitmap is
 * fully decoded before it becomes visible — the element never paints in
 * progressively top-to-bottom.
 *
 * The component forwards every native `<img>` attribute and merges the
 * caller's `className`, so existing CSS module classes keep working
 * unchanged at the call site.
 */
export function FadeInImage({
  className,
  onLoad,
  onError,
  onReady,
  src,
  ...rest
}: FadeInImageProps) {
  const [loaded, setLoaded] = useState(false);
  // Reset `loaded` when `src` changes by comparing prop to a memo of the
  // previous value during render (the React-recommended pattern for
  // prop-derived state without an effect). Avoids the cascade-render
  // hazard `react-hooks/set-state-in-effect` flags for the effect form.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setLoaded(false);
  }

  const reveal = (): void => {
    setLoaded(true);
    onReady?.();
  };

  const setRef = (el: HTMLImageElement | null): void => {
    if (el && el.complete && el.naturalWidth > 0 && !loaded) {
      reveal();
    }
  };

  const composedClassName = [
    styles.fade,
    loaded ? styles.loaded : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      {...rest}
      ref={setRef}
      src={src}
      className={composedClassName}
      onLoad={(event) => {
        const img = event.currentTarget;
        // Wait for a full decode so the bitmap is ready in one shot rather
        // than painting in progressively. `decode()` may reject on
        // detached/aborted images — reveal anyway so we never strand the
        // element invisible.
        if (typeof img.decode === "function") {
          img.decode().then(reveal, reveal);
        } else {
          reveal();
        }
        onLoad?.(event);
      }}
      onError={(event) => {
        // Reveal the broken-image / alt-text fallback rather than leaving
        // the element invisible at opacity 0.
        reveal();
        onError?.(event);
      }}
    />
  );
}
