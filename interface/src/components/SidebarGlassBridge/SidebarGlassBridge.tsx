import { useSidebarGlass } from "../../hooks/use-sidebar-glass";

/**
 * Renders nothing; runs `useSidebarGlass()` for its side effect so the
 * persisted "Glass sidebar" preference is applied to
 * `document.documentElement` on mount. Mounted once inside `<ThemeProvider>`
 * in `main.tsx`, sibling to `<ThemeOverridesBridge />`.
 */
export function SidebarGlassBridge(): null {
  useSidebarGlass();
  return null;
}
