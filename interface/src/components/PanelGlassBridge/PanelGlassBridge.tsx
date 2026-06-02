import { usePanelGlass } from "../../hooks/use-panel-glass";

/**
 * Renders nothing; runs `usePanelGlass()` for its side effect so the
 * persisted per-panel glass preferences are applied to
 * `document.documentElement` on mount. Mounted once inside `<ThemeProvider>`
 * in `main.tsx`, sibling to `<ThemeOverridesBridge />`.
 */
export function PanelGlassBridge(): null {
  usePanelGlass();
  return null;
}
