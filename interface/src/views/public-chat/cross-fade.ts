import { useEffect, useState } from "react";

/**
 * Shared cross-fade lifecycle used by every public-mode surface that
 * swaps a visual snapshot when the active persona changes — currently
 * the page background painted on `.chatView` (see
 * `PublicChatView.tsx`) and the desktop wallpaper rendered inside
 * the mock window (see `MockAuraApp.tsx`).
 *
 * The hook tracks the previous snapshot in state and, whenever
 * `signatureKey` changes, keeps it alive for one more render so the
 * caller can mount two stacked layers — one fading out (the outgoing
 * snapshot) and one fading in (the current snapshot). The matching
 * `.layerEntering` / `.layerLeaving` classes in
 * `cross-fade.module.css` drive the actual opacity animation; this
 * module just owns the React state machine that decides which
 * snapshot belongs in which slot at any moment.
 *
 * Capture-during-render
 * ---------------------
 * The swap is detected during render and committed with a synchronous
 * `setState` call (the "Adjusting some state when a prop changes"
 * pattern from the official React docs). This mounts the outgoing
 * layer in the same paint as the entering layer — deferring it to a
 * `useEffect` would mean the entering layer mounts ONE paint before
 * the outgoing layer, producing a visible pop-in on `object-fit:
 * contain` wallpapers (whose letterbox bars briefly reveal whatever
 * was under the old `<img>`).
 *
 * Why a setTimeout instead of `onAnimationEnd`
 * --------------------------------------------
 * jsdom never fires CSS animation events, so a test-friendly teardown
 * needs an explicit timer. The `fadeMs + 50ms` buffer covers easing
 * slop without producing a visible re-flash — the matching CSS rule
 * pins the leaving layer's opacity at 0 via `animation-fill-mode:
 * forwards`, so even if the unmount lags the animation the user never
 * sees a one-frame opacity-1 flicker.
 *
 * Rapid swaps
 * -----------
 * A monotonically-increasing `__crossFadeId` is attached to each
 * outgoing snapshot so React always sees a fresh key when consecutive
 * swaps race. The teardown closure checks the id before clearing so
 * an older timer firing late never wipes a newer outgoing snapshot.
 */
export interface CrossFadeLayers<T> {
  /**
   * Snapshot of the previous value that should be rendered as the
   * fading-out layer. `null` outside of an active swap (steady state).
   * The `__crossFadeId` field gives React a stable key so consecutive
   * swaps mount distinct DOM nodes.
   */
  readonly outgoing: (T & { readonly __crossFadeId: number }) | null;
  /**
   * Snapshot of the value the consumer just passed in — rendered as
   * the fading-in layer (or simply the steady-state layer when no
   * swap is in flight).
   */
  readonly current: T;
}

/**
 * Internal state shape. Lives in a single `useState` cell so the
 * during-render commit is one synchronous setter call (React bails
 * out cleanly when the object reference doesn't change, so we don't
 * re-render in a loop).
 */
interface CrossFadeState<T> {
  readonly trackedKey: string;
  readonly previous: T;
  readonly outgoing: (T & { readonly __crossFadeId: number }) | null;
  readonly nextId: number;
}

export function useCrossFadeLayers<T>(
  current: T,
  signatureKey: string,
  fadeMs: number = 220,
): CrossFadeLayers<T> {
  const [state, setState] = useState<CrossFadeState<T>>(() => ({
    trackedKey: signatureKey,
    previous: current,
    outgoing: null,
    nextId: 1,
  }));

  if (state.trackedKey !== signatureKey) {
    setState((prev) => ({
      trackedKey: signatureKey,
      previous: current,
      outgoing: { ...prev.previous, __crossFadeId: prev.nextId } as T & {
        readonly __crossFadeId: number;
      },
      nextId: prev.nextId + 1,
    }));
  }

  const outgoingId = state.outgoing?.__crossFadeId;
  useEffect(() => {
    if (outgoingId == null) return;
    const timer = window.setTimeout(() => {
      setState((prev) =>
        prev.outgoing?.__crossFadeId === outgoingId
          ? { ...prev, outgoing: null }
          : prev,
      );
    }, fadeMs + 50);
    return () => window.clearTimeout(timer);
  }, [outgoingId, fadeMs]);

  return { outgoing: state.outgoing, current };
}
