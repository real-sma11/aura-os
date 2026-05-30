import { useCallback, useMemo } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useUIModeStore, type UIMode } from "../../stores/ui-mode-store";
import { useEffectiveMode } from "../../stores/use-effective-mode";
import { getLastAdvancedPath, getLastSimplePath } from "../../utils/storage";
import { SlidingPills, type SlidingPillItem } from "../SlidingPills";
import styles from "./ModeToggle.module.css";

/**
 * The pill toggle is a binary control over the two persistable
 * authenticated modes; `"public"` is derived from auth and never
 * written by this control.
 */
type ToggleMode = Exclude<UIMode, "public">;

const ITEMS: ReadonlyArray<SlidingPillItem<ToggleMode>> = [
  { id: "simple", label: "Simple", title: "Simplified chat surface" },
  { id: "advanced", label: "Advanced", title: "Full app shell" },
];

/**
 * Two-segment pill toggle for the global UI complexity mode. Lives at
 * the top-left of every sidebar (under the search input) so users can
 * flip between the simplified Simple chat surface and the full
 * Advanced shell from any app.
 *
 * Built on `SlidingPills` so the slide animation, accessibility
 * semantics (`role="radiogroup"` / `role="radio"`), and keyboard
 * navigation all match the agent input's `ModeSelector` (Code / Plan
 * / Image / Video / 3D), making the two controls feel like one
 * family.
 *
 * Public-mode behavior: the toggle returns `null` whenever the
 * effective mode is `"public"` (logged-out visitors). `AuraSidebar`
 * already gates the render with the same condition so this is
 * defense-in-depth — direct mounts (e.g. tests, future surfaces)
 * still get the right answer. The slide-not-snap invariant for the
 * Simple <-> Advanced flip is preserved because the toggle only
 * unmounts across the public boundary, which is a discrete login
 * event where remount + snap is the correct UX.
 */
export function ModeToggle(): React.ReactElement | null {
  const mode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);
  const effectiveMode = useEffectiveMode();
  const navigate = useNavigate();

  const items = useMemo(() => ITEMS, []);
  // The store's `mode` carries the full `UIMode` union (including
  // `"public"`), but the toggle only ever pictures `simple`/`advanced`.
  // When the persisted value is `"public"` (logged-out users, or a
  // stale write), we still want the indicator to land on a valid
  // segment; default to `"simple"`, matching `selectEffectiveMode`'s
  // squash for logged-in `"public"`.
  const value: ToggleMode = mode === "advanced" ? "advanced" : "simple";

  const handleChange = useCallback(
    (next: ToggleMode): void => {
      const changed = next !== value;
      // Re-clicking the already-active segment is a no-op for the URL,
      // so the mode write can stand alone (it short-circuits in the
      // store anyway when the value is unchanged).
      if (!changed) {
        setMode(next);
        return;
      }
      // Restore the URL the user had last seen in the destination
      // mode so flipping the toggle takes them back to the app + item
      // they were on (Advanced) or the chat session they were in
      // (Simple). Both stored values are validated by the storage
      // helpers (Simple must be `/chat...`, Advanced must not be) so
      // a hand-edited / stale entry can't drive `navigate()` to an
      // invalid surface. No-op fallback when the destination bucket is
      // empty: in Simple, `ChatRedirectGuard` already pulls non-chat
      // paths to `/chat`; in Advanced, staying on the current URL
      // (e.g. `/chat`) is the correct minimum-surprise default since
      // `/chat` is also a valid Advanced surface.
      const target =
        next === "advanced" ? getLastAdvancedPath() : getLastSimplePath();
      // Commit the mode flip and the route change in a single render.
      // `useActiveApp` derives the shell's active app from BOTH the
      // mode store and the router pathname; updating them in separate
      // commits leaves a one-frame window where `effectiveMode` is the
      // new mode but `pathname` is stale, so `resolveActiveApp` misses
      // and falls back to the first registered app — the visible
      // "jump to the first app, then the real app" jank. `flushSync`
      // forces both external-store updates into one commit so the
      // chrome moves straight from the source app to the destination.
      flushSync(() => {
        setMode(next);
        if (target) {
          navigate(target);
        }
      });
    },
    [navigate, setMode, value],
  );

  if (effectiveMode === "public") return null;

  return (
    <div
      className={styles.root}
      data-agent-surface="ui-mode-toggle"
    >
      <SlidingPills
        items={items}
        value={value}
        onChange={handleChange}
        ariaLabel="Interface mode"
        className={styles.pills}
        segmentClassName={styles.segment}
        indicatorClassName={styles.indicator}
        indicatorTestId="ui-mode-indicator"
      />
    </div>
  );
}
