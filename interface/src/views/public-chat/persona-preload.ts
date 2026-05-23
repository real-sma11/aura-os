import { useEffect, useRef, useState } from "react";
import { PERSONAS, getPersonaAt, type Persona } from "./personas";

/**
 * Decode-gated commit hook for the public-mode persona swap.
 *
 * Why this exists
 * ---------------
 * The page background (painted by `PublicChatView`) and the desktop
 * wallpaper inside the mock window (painted by `MockAuraApp`) both
 * cross-fade when the visitor picks a new tick. Without this hook the
 * two surfaces would commit their new `<img>` elements in the same
 * React render but the browser would still need to fetch + decode the
 * new images independently; whichever finishes first pops in mid-fade
 * while the other stays blank, producing a jerk on every swap.
 *
 * `useDecodedPersonaIndex` interposes between the user-driven target
 * index and the index the rendering surfaces actually consume:
 *
 *   1. On mount it eagerly preloads every persona's
 *      `desktopBackgroundUrl` and `siteBackgroundUrl` via the native
 *      `<img>.decode()` API. The asset set is tiny (≈4 desktop + 2
 *      site PNGs today) and all are same-origin static files, so the
 *      one-time cost is negligible and kills first-click lag.
 *   2. When the target changes the hook checks whether every URL the
 *      new persona needs is already in the decoded set:
 *        - YES → commit synchronously in the same render. Switching
 *          between two `NO_THEME` personas (no URLs at all) also takes
 *          this path so the cheap case stays cheap.
 *        - NO → kick off decode for the missing URLs and only call
 *          `setCommittedIndex` once they finish. The outgoing persona
 *          stays painted on screen the whole time, so the visitor
 *          sees the old state held until the new state is paint-ready.
 *   3. A monotonically-increasing token guards the async commit so a
 *      rapid second click cancels any earlier in-flight commit — only
 *      the latest target ever wins.
 *
 * The hook is decode-aware, not render-aware: it decides WHEN it's
 * safe to swap, not HOW the swap is animated. The cross-fade primitive
 * in `cross-fade.ts` consumes the resulting committed index and runs
 * the actual opacity dissolve.
 */

/**
 * Collect the image URLs we must hold the commit for. NO_THEME
 * personas return an empty array so the gate is a pass-through.
 */
function imageUrlsFor(persona: Persona): readonly string[] {
  const { desktopBackgroundUrl, siteBackgroundUrl } = persona.theme;
  const urls: string[] = [];
  if (desktopBackgroundUrl) urls.push(desktopBackgroundUrl);
  if (siteBackgroundUrl) urls.push(siteBackgroundUrl);
  return urls;
}

/**
 * Best-effort decode. Resolves successfully on `onerror` too — a
 * missing 404'd asset is a content bug, not something that should
 * permanently wedge the persona swap UI. `decode()` is widely
 * supported in modern browsers; the `??` fallback keeps the helper
 * usable under jsdom (where `decode` is undefined by default unless
 * the test setup patches it).
 */
function decodeImageUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve();
    const finalize = (): void => resolve();
    img.src = url;
    const decoder = img.decode?.bind(img);
    if (decoder) {
      decoder().then(finalize, finalize);
    } else {
      img.onload = finalize;
    }
  });
}

export function useDecodedPersonaIndex(targetIndex: number): number {
  // `committedIndex` is what consumers render against. Initialised to
  // the target so the first paint never has to wait on a decode
  // (browsers can render an un-decoded `<img>` just fine; we only
  // need the gate when SWAPPING between personas, not on the very
  // first mount). The matching effect below kicks off the preload so
  // subsequent swaps are already warmed.
  const [committedIndex, setCommittedIndex] = useState<number>(targetIndex);

  // Module-scoped set of URLs whose decode has already resolved.
  // Lives in a ref so the preload effect can populate it without
  // forcing re-renders, and the synchronous gate below can read the
  // freshest value during render.
  const decodedRef = useRef<Set<string>>(new Set());
  // Monotonic token. Bumped at the start of every async commit;
  // captured by the closure that calls `setCommittedIndex` and
  // re-checked before the call so a stale resolve never overwrites
  // a newer commit.
  const commitTokenRef = useRef<number>(0);

  // Eager preload on mount. Effect (not render) so the first paint
  // isn't blocked on network. Best-effort: any decode that fails is
  // silently dropped — the per-swap gate below will retry it later.
  useEffect(() => {
    let cancelled = false;
    for (const persona of PERSONAS) {
      for (const url of imageUrlsFor(persona)) {
        if (decodedRef.current.has(url)) continue;
        void decodeImageUrl(url).then(() => {
          if (cancelled) return;
          decodedRef.current.add(url);
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Decode-gated commit. Runs whenever the target changes; awaits
  // the missing decodes (an empty list still resolves on the next
  // microtask, so the routing is consistent for both the warm path
  // and the cold path) and only then calls `setCommittedIndex`.
  // The cleanup function bumps the token so a later target change
  // invalidates any commit still in flight.
  useEffect(() => {
    if (targetIndex === committedIndex) return;
    const persona = getPersonaAt(targetIndex);
    const needed = imageUrlsFor(persona);
    const pending = needed.filter((url) => !decodedRef.current.has(url));
    const token = ++commitTokenRef.current;
    void Promise.all(pending.map(decodeImageUrl)).then(() => {
      if (token !== commitTokenRef.current) return;
      for (const url of pending) decodedRef.current.add(url);
      setCommittedIndex(targetIndex);
    });
    return () => {
      commitTokenRef.current += 1;
    };
  }, [targetIndex, committedIndex]);

  return committedIndex;
}
