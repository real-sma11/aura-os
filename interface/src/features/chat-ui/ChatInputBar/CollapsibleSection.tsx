import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import styles from "./ChatInputBar.module.css";

export interface CollapsibleSectionProps {
  open: boolean;
  children: ReactNode;
}

/**
 * Height-animated collapsible wrapper. The grid `0fr -> 1fr` CSS trick
 * proved unreliable in the desktop webview, so we measure the content
 * with a ref and animate an explicit `height` between `0` and the
 * measured pixel height, settling on `auto` once expanded so dynamic
 * content (e.g. the cache row appearing) isn't clipped. The first render
 * is applied without animation so opening the popover doesn't replay the
 * expand each time.
 */
export function CollapsibleSection({
  open,
  children,
}: CollapsibleSectionProps): ReactElement {
  const innerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    // Skip animation on the initial mount; just reflect the open state.
    if (!mountedRef.current) {
      mountedRef.current = true;
      setHeight(open ? "auto" : 0);
      return;
    }

    if (open) {
      // 0 (or px) -> measured height, then release to auto.
      setHeight(el.scrollHeight);
      const timer = window.setTimeout(() => setHeight("auto"), 240);
      return () => window.clearTimeout(timer);
    }

    // auto -> fixed px (so the browser has a start value) -> 0.
    setHeight(el.scrollHeight);
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setHeight(0));
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [open]);

  return (
    <div
      className={styles.contextSectionCollapse}
      style={{ height: height === "auto" ? "auto" : `${height}px` }}
      aria-hidden={!open}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
