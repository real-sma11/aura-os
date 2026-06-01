import { useCallback, useMemo } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useUIModeStore, type UIMode } from "../../stores/ui-mode-store";
import { useEffectiveMode } from "../../stores/use-effective-mode";
import { getLastAdvancedPath, getLastSimplePath } from "../../utils/storage";
import {
  agentSessionHistoryKey,
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../stores/chat-history-store";
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

interface CrossSurfaceTarget {
  /** Destination URL for the same conversation on the other surface. */
  path: string;
  /** Transcript key the current surface reads. */
  fromKey: string;
  /** Transcript key the destination surface will read. */
  toKey: string;
}

/**
 * When the user is viewing a specific chat conversation, resolve the
 * URL + transcript keys for the SAME conversation on the destination
 * surface. Simple `/chat` and Advanced `/agents/...` render the same
 * conversation through different orchestrators with different
 * `chat-history-store` keys (`agent:<id>:session:<sid>` vs
 * `session:<proj>:<inst>:<sid>`). Returning the destination key lets
 * the toggle pre-warm it so the destination paints immediately
 * instead of re-running ChatPanel's cold-load reveal.
 *
 * Returns `null` when the location isn't a resolvable conversation
 * (e.g. a fresh canvas with no `?session=`, or a non-chat Advanced
 * app), in which case the caller falls back to last-path restore.
 */
function resolveCrossSurfaceTarget(
  next: ToggleMode,
  pathname: string,
  search: string,
): CrossSurfaceTarget | null {
  const params = new URLSearchParams(search);
  const project = params.get("project");
  const instance = params.get("instance");
  const session = params.get("session");
  if (!project || !instance || !session) return null;

  if (next === "advanced") {
    if (!pathname.startsWith("/chat")) return null;
    const agent = params.get("agent");
    if (!agent) return null;
    const destParams = new URLSearchParams({ project, instance, session });
    return {
      path: `/agents/${agent}?${destParams.toString()}`,
      fromKey: agentSessionHistoryKey(agent, session),
      toKey: sessionHistoryKey(project, instance, session),
    };
  }

  const agent = pathname.match(/^\/agents\/([^/?]+)/)?.[1];
  if (!agent) return null;
  const destParams = new URLSearchParams({ agent, project, instance, session });
  return {
    path: `/chat?${destParams.toString()}`,
    fromKey: sessionHistoryKey(project, instance, session),
    toKey: agentSessionHistoryKey(agent, session),
  };
}

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
  const { pathname, search } = useLocation();

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
      //
      // When the user is mid-conversation, prefer keeping that exact
      // conversation across the surface swap and pre-warm the
      // destination's transcript cache, so the chat paints the same
      // content immediately instead of re-running ChatPanel's cold-load
      // reveal + reflow. Falls back to last-path restore otherwise.
      const crossSurface = resolveCrossSurfaceTarget(next, pathname, search);
      if (crossSurface) {
        useChatHistoryStore
          .getState()
          .aliasHistoryEntry(crossSurface.fromKey, crossSurface.toKey);
      }
      const target =
        crossSurface?.path ??
        (next === "advanced" ? getLastAdvancedPath() : getLastSimplePath());
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
    [navigate, pathname, search, setMode, value],
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
