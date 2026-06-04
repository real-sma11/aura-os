import { usePanelGlass } from "../../hooks/use-panel-glass";
import { useGlassLevel } from "../../hooks/use-glass-level";

/**
 * Renders nothing; runs `usePanelGlass()` and `useGlassLevel()` for their
 * side effects so the persisted per-panel glass preferences (the
 * `data-glass-*` attributes) and the glass blur/opacity level (the
 * `--shell-chrome-blur` / `--shell-chrome-opacity` custom properties) are
 * applied to `document.documentElement` on mount. Mounted once inside
 * `<ThemeProvider>` in `main.tsx`, sibling to `<ThemeOverridesBridge />`.
 */
export function PanelGlassBridge(): null {
  usePanelGlass();
  useGlassLevel();
  return null;
}
