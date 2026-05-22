import { useState } from "react";
import styles from "./FadeInImage.module.css";

type FadeInImageProps = React.ImgHTMLAttributes<HTMLImageElement>;

/**
 * Drop-in replacement for `<img>` that fades in once the browser has
 * decoded the image. Already-decoded (cached) images skip the fade by
 * checking `img.complete && img.naturalWidth > 0` on the ref callback,
 * so re-rendered or re-opened images don't flicker.
 * `prefers-reduced-motion` disables the transition entirely.
 *
 * The component forwards every native `<img>` attribute and merges the
 * caller's `className`, so existing CSS module classes keep working
 * unchanged at the call site.
 */
export function FadeInImage({
  className,
  onLoad,
  onError,
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

  const setRef = (el: HTMLImageElement | null): void => {
    if (el && el.complete && el.naturalWidth > 0 && !loaded) {
      setLoaded(true);
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
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        // Reveal the broken-image / alt-text fallback rather than leaving
        // the element invisible at opacity 0.
        setLoaded(true);
        onError?.(event);
      }}
    />
  );
}
