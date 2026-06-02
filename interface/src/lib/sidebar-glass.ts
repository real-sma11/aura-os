/**
 * Persistence + DOM application for the "Glass sidebar" theme option. When
 * enabled, the left panel (`AuraSidebar`) underlay swaps its solid fill for a
 * frosted translucent backdrop-filter (see the `[data-sidebar-glass="true"]`
 * rule in `AuraShell.module.css`).
 *
 * The effect is enabled by default: {@link loadSidebarGlass} returns `true`
 * unless the user has explicitly turned it off (stored value `"false"`). A
 * value is only written to storage when the user toggles the setting, so the
 * default can evolve without being pinned by a stale stored `"true"`.
 *
 * The attribute lives on `document.documentElement` (mirroring `data-theme`)
 * so the boot script in `index.html` can pre-stamp it before React mounts.
 */

const STORAGE_KEY = "aura-sidebar-glass";
const ATTR = "data-sidebar-glass";

export function loadSidebarGlass(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Absent / unparseable means "use default" (on); only an explicit
    // "false" disables it.
    return raw !== "false";
  } catch {
    return true;
  }
}

export function saveSidebarGlass(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "true" : "false");
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore so the UI
    // stays responsive. In-memory hook state remains the source of truth
    // for the current session.
  }
}

export function applySidebarGlassToDocument(on: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (on) {
    root.setAttribute(ATTR, "true");
  } else {
    root.removeAttribute(ATTR);
  }
}
