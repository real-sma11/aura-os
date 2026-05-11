import { type CSSProperties, type ReactNode } from "react";
import { useProjectAppearance } from "../../hooks/use-project-appearance";
import styles from "./ProjectAppearanceFrame.module.css";

interface ProjectAppearanceFrameProps {
  projectId: string | null | undefined;
  children: ReactNode;
}

/**
 * Wraps the project's content area and emits CSS custom properties
 * derived from the project's `appearance.json`. Descendant components
 * opt into per-project styling by reading the variables — there is no
 * inline coupling between this frame and individual surfaces.
 *
 * Variables emitted:
 *
 * - `--project-accent` — accent color hex, or `unset` so children can
 *   fall back to a theme default.
 * - `--project-bg-color` — background tint color.
 * - `--project-bg-opacity` — opacity (0..1) applied to the pattern
 *   overlay, *not* the color.
 *
 * The background pattern is switched via the `data-bg-pattern`
 * attribute (read by `ProjectAppearanceFrame.module.css`) rather than
 * a CSS variable, because `background-image` can't be parametrized
 * cleanly with custom properties when the value is a `url()` /
 * gradient that differs in shape between patterns.
 */
export function ProjectAppearanceFrame({
  projectId,
  children,
}: ProjectAppearanceFrameProps) {
  const { appearance } = useProjectAppearance(projectId);

  const style: CSSProperties = {};
  if (appearance.accent) {
    (style as Record<string, string>)["--project-accent"] = appearance.accent;
  }
  if (appearance.background?.color) {
    (style as Record<string, string>)["--project-bg-color"] =
      appearance.background.color;
  }
  if (typeof appearance.background?.opacity === "number") {
    (style as Record<string, string>)["--project-bg-opacity"] =
      String(appearance.background.opacity);
  }

  const pattern = appearance.background?.pattern ?? "none";

  return (
    <div
      className={styles.frame}
      style={style}
      data-bg-pattern={pattern}
      data-project-id={projectId ?? undefined}
    >
      {children}
    </div>
  );
}
