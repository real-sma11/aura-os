import { windowCommand } from "./windowCommand";

// On Windows, the wry-managed WebView2 container HWND is created as a
// child window that fills the entire parent client area and returns
// `HTCLIENT` from its default windowproc. Windows therefore routes
// `WM_NCHITTEST` to the WebView2 child for any cursor position inside
// the visible window — never to the parent HWND where the
// `expand_top_resize_border` subclass in
// `apps/aura-os-desktop/src/ui/chrome.rs` lives. The native subclass
// only fires for the 1-logical-pixel non-client strip tao reserves at
// the very top of the parent on Windows 11 (and 0 px on Windows 10),
// which is far too thin to grab reliably.
//
// macOS / Linux have analogous capture: `WKWebView` and `WebKitGTK`
// both swallow mouse events before they ever reach tao's edge resize
// detection.
//
// The web layer, however, DOES see those events: pointer events fire
// on `document` regardless of which native HWND / view received them
// first. So we install a document-level listener that:
//
// 1. Watches `pointermove` and paints the body cursor to `n-resize`
//    while the cursor is in the top resize band. The body-level
//    cursor naturally yields to higher-specificity cursors set on
//    interactive descendants (buttons, links), so titlebar pill
//    buttons still show their pointer cursor.
// 2. On `pointerdown` with the primary button inside the band — and
//    only when the press is NOT on an interactive control — IPCs
//    `resize-n` to Rust, which calls
//    `tao::Window::drag_resize_window(ResizeDirection::North)` and
//    hands off to the OS native resize loop.
//
// Scope: top edge only for now. Adding corners / other edges is a
// straightforward extension once we have demand for it.

/** Logical-pixel thickness of the top resize hit band. Kept in sync
 * with `TOP_RESIZE_BORDER_LOGICAL_PX` in
 * `apps/aura-os-desktop/src/ui/chrome.rs`. */
export const TOP_RESIZE_BAND_LOGICAL_PX = 14;

// Selectors for elements inside the top band that should NOT trigger
// a native resize on pointerdown. Mirrors
// `INTERACTIVE_NO_DRAG_SELECTOR` in `native-titlebar-drag.ts` plus the
// titlebar pill's own opt-out class.
const INTERACTIVE_NO_RESIZE_SELECTOR =
  "button, a, input, textarea, select, [role='button'], .titlebar-no-drag";

function isInTopResizeBand(clientY: number): boolean {
  return clientY >= 0 && clientY < TOP_RESIZE_BAND_LOGICAL_PX;
}

function isOverInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (typeof target.closest !== "function") return false;
  return target.closest(INTERACTIVE_NO_RESIZE_SELECTOR) !== null;
}

export function shouldShowTopResizeCursor(event: {
  clientY: number;
}): boolean {
  return isInTopResizeBand(event.clientY);
}

export function shouldStartTopResize(event: PointerEvent): boolean {
  if (event.button !== 0) return false;
  if (!isInTopResizeBand(event.clientY)) return false;
  if (isOverInteractiveTarget(event.target)) return false;
  return true;
}

export function shouldInstallNativeTitlebarResize(
  hasDesktopBridge: boolean,
): boolean {
  return hasDesktopBridge;
}

let installedDownHandler: ((event: PointerEvent) => void) | null = null;
let installedMoveHandler: ((event: PointerEvent) => void) | null = null;
let cursorOverridden = false;

function setBodyResizeCursor(active: boolean): void {
  if (typeof document === "undefined" || !document.body) return;
  if (active) {
    document.body.style.cursor = "n-resize";
    cursorOverridden = true;
  } else if (cursorOverridden) {
    // Only clear when we previously set it, so we never clobber a
    // body-level cursor that someone else (a future feature) may have
    // assigned.
    document.body.style.cursor = "";
    cursorOverridden = false;
  }
}

export function installNativeTitlebarResize(): void {
  if (installedDownHandler || installedMoveHandler) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const hasDesktopBridge = typeof window.ipc?.postMessage === "function";
  if (!shouldInstallNativeTitlebarResize(hasDesktopBridge)) return;

  const moveHandler = (event: PointerEvent) => {
    setBodyResizeCursor(shouldShowTopResizeCursor(event));
  };
  const downHandler = (event: PointerEvent) => {
    if (!shouldStartTopResize(event)) return;
    windowCommand("resize-n");
  };

  document.addEventListener("pointermove", moveHandler, { capture: true });
  document.addEventListener("pointerdown", downHandler, { capture: true });
  installedMoveHandler = moveHandler;
  installedDownHandler = downHandler;
}

export function __resetNativeTitlebarResizeForTests(): void {
  if (typeof document !== "undefined") {
    if (installedMoveHandler) {
      document.removeEventListener("pointermove", installedMoveHandler, {
        capture: true,
      } as EventListenerOptions);
    }
    if (installedDownHandler) {
      document.removeEventListener("pointerdown", installedDownHandler, {
        capture: true,
      } as EventListenerOptions);
    }
  }
  installedMoveHandler = null;
  installedDownHandler = null;
  setBodyResizeCursor(false);
}
