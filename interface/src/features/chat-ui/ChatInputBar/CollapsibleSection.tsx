import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type TransitionEvent,
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
 * content (e.g. the cache row appearing) isn't clipped.
 *
 * The animation only fires if the browser paints a definite start height
 * before the end height is applied. We guarantee that here by writing the
 * start height to the DOM and forcing a synchronous reflow (`offsetHeight`)
 * in a layout effect, then committing the end height via React state. Open
 * settles back to `auto` on `transitionend` rather than a timer so it never
 * races the CSS duration. The first mount is applied without animation so
 * opening the popover doesn't replay the expand each time.
 */
export function CollapsibleSection({
  open,
  children,
}: CollapsibleSectionProps): ReactElement {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    // Skip animation on the initial mount; just reflect the open state.
    if (!mountedRef.current) {
      mountedRef.current = true;
      setHeight(open ? "auto" : 0);
      return;
    }

    const full = inner.scrollHeight;
    // Flush the start height so the browser has a value to animate from,
    // then let React commit the end height on the next render.
    outer.style.height = open ? "0px" : `${full}px`;
    void outer.offsetHeight; // force reflow
    setHeight(open ? full : 0);
  }, [open]);

  const handleTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    // Ignore transitions bubbling up from the content (e.g. the chevron).
    if (e.target !== outerRef.current || e.propertyName !== "height") return;
    if (open) setHeight("auto");
  };

  return (
    <div
      ref={outerRef}
      className={styles.contextSectionCollapse}
      style={{ height: height === "auto" ? "auto" : `${height}px` }}
      aria-hidden={!open}
      onTransitionEnd={handleTransitionEnd}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
