import type { ComponentType } from "react";
import {
  Palette,
  Type,
  LayoutGrid,
  Droplets,
  Sparkles,
  Zap,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { ModeAccentPane } from "./panes/ModeAccentPane";
import { TypographyPane } from "./panes/TypographyPane";
import { LayoutPane } from "./panes/LayoutPane";
import { ColorsPane } from "./panes/ColorsPane";
import { EffectsPane } from "./panes/EffectsPane";
import { MotionPane } from "./panes/MotionPane";
import { PresetsPane } from "./panes/PresetsPane";

export type ThemeSubAreaId =
  | "mode"
  | "typography"
  | "layout"
  | "colors"
  | "effects"
  | "motion"
  | "presets";

export type ThemeSubArea = {
  id: ThemeSubAreaId;
  label: string;
  icon: LucideIcon;
  Component: ComponentType;
};

/**
 * Ordered registry of Theme sub-areas. Consumed two ways:
 *  - `AppearanceSection` stacks every pane on one scroll (route page + mobile).
 *  - `OrgSettingsPanel` drill-down renders one pane at a time behind a
 *    "<- Settings > Theme" breadcrumb and lists these as the sub-nav.
 */
export const THEME_SUB_AREAS: readonly ThemeSubArea[] = [
  { id: "mode", label: "Mode & accent", icon: Palette, Component: ModeAccentPane },
  { id: "typography", label: "Typography", icon: Type, Component: TypographyPane },
  { id: "layout", label: "Layout & density", icon: LayoutGrid, Component: LayoutPane },
  { id: "colors", label: "Custom colors", icon: Droplets, Component: ColorsPane },
  { id: "effects", label: "Effects", icon: Sparkles, Component: EffectsPane },
  { id: "motion", label: "Motion", icon: Zap, Component: MotionPane },
  { id: "presets", label: "Presets", icon: Bookmark, Component: PresetsPane },
];

export const DEFAULT_THEME_SUB_AREA: ThemeSubAreaId = "mode";
