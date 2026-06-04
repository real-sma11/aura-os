import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Re-arms the shared sidebar "cascade in" row entrance (see the
 * `--aura-list-cascade-*` tokens + `aura-list-cascade-in` keyframe in
 * index.css). `LeftMenu` stamps `data-cascade="true"` on the active pane for a
 * short window keyed to `activeAppId`, but list rows (agents, projects) load
 * asynchronously and often mount *after* that window has already closed — so
 * nothing animates on first load. The active pane exposes `armCascade` through
 * this context; its list calls it once its rows first appear, restarting the
 * window so the freshly-mounted rows cascade in.
 *
 * The default is a no-op so `LeftMenuTree`-backed lists rendered outside the
 * shared `LeftMenu` (where there is no pane to arm) stay inert.
 */
export type ArmCascade = () => void;

const NOOP_ARM: ArmCascade = () => {};

export const CascadeArmContext = createContext<ArmCascade>(NOOP_ARM);

export { NOOP_ARM };

/**
 * Calls the active pane's `armCascade` when `hasContent` transitions from
 * false to true (i.e. the list's first rows land). Guards against re-arming on
 * every render or on steady-state row churn so only the empty -> populated
 * reveal cascades.
 */
export function useArmCascadeOnContent(hasContent: boolean): void {
  const arm = useContext(CascadeArmContext);
  const prevHadContent = useRef(false);

  useEffect(() => {
    if (hasContent && !prevHadContent.current) {
      arm();
    }
    prevHadContent.current = hasContent;
  }, [arm, hasContent]);
}
