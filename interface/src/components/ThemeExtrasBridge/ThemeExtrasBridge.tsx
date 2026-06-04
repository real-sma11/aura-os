import { useTypography } from "../../hooks/use-theme-typography";
import { useLayout } from "../../hooks/use-theme-layout";
import { useMotion } from "../../hooks/use-theme-motion";

/**
 * Renders nothing; runs the typography / layout / motion hooks for their side
 * effects so the persisted Settings > Theme preferences (font stacks, text
 * scale, corner radius, density, transition speed, reduce-motion) are applied
 * to `document.documentElement` on mount and kept in sync. Mounted once inside
 * `<ThemeProvider>` in `main.tsx`, sibling to `<PanelGlassBridge />`.
 */
export function ThemeExtrasBridge(): null {
  useTypography();
  useLayout();
  useMotion();
  return null;
}
