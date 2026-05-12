import { Sun, Moon } from "lucide-react";
import { useTheme } from "@cypher-asi/zui";
import { TaskbarIconButton, TASKBAR_ICON_SIZE } from "../AppNavRail";
import {
  cycleTheme,
  getThemeToggleAriaLabel,
  getThemeToggleIconKind,
} from "../../lib/theme-toggle";

const ICON_BY_KIND = {
  sun: Sun,
  moon: Moon,
} as const;

export function ThemeToggleButton() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const Icon = ICON_BY_KIND[getThemeToggleIconKind(theme, resolvedTheme)];
  const label = getThemeToggleAriaLabel(theme, resolvedTheme);

  return (
    <TaskbarIconButton
      icon={<Icon size={TASKBAR_ICON_SIZE} />}
      title={label}
      aria-label={label}
      onClick={() => setTheme(cycleTheme(theme, resolvedTheme))}
    />
  );
}
