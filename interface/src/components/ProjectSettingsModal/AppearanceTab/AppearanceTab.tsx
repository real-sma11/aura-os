import { useCallback } from "react";
import { DynamicIcon } from "lucide-react/dynamic";
import { Folder } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useProjectAppearance } from "../../../hooks/use-project-appearance";
import type { ProjectAppearance } from "../../../shared/api/appearance";
import { AccentColorPicker } from "./AccentColorPicker";
import { BackgroundControl } from "./BackgroundControl";
import { BannerControl } from "./BannerControl";
import { LucideIconPicker } from "./LucideIconPicker";
import styles from "./AppearanceTab.module.css";

interface AppearanceTabProps {
  projectId: string;
  /** Project display name, shown in the live preview chip so the user
   *  can see how the project will appear in the sidebar / headers. */
  projectName?: string;
}

/**
 * Body of the Appearance tab in the project settings modal. Owns the
 * composition of the four controls (accent, icon, banner, background)
 * and wires their changes through `useProjectAppearance`, which
 * applies updates optimistically across the app so the user sees a
 * live preview while editing.
 *
 * Save semantics: each control writes through immediately. There is
 * no separate "Save" for this tab — the modal's footer Save button
 * only affects the Integrations / General tabs. This is intentional:
 * appearance is a low-stakes personal preference, and a live preview
 * across the actual app surfaces beats a confirm-modal flow.
 */
export function AppearanceTab({ projectId, projectName }: AppearanceTabProps) {
  const { appearance, update, uploadBanner, deleteBanner, bannerUrl } =
    useProjectAppearance(projectId);

  // Merge a partial change into the full appearance shape and write
  // through. The server replaces the file wholesale, so we always
  // send the complete object.
  const patch = useCallback(
    (changes: Partial<ProjectAppearance>) => {
      const next: ProjectAppearance = { ...appearance, ...changes };
      // Drop top-level keys that resolve to `undefined` so the
      // persisted JSON stays clean.
      (Object.keys(next) as (keyof ProjectAppearance)[]).forEach((k) => {
        if (next[k] === undefined) delete next[k];
      });
      void update(next);
    },
    [appearance, update],
  );

  return (
    <div className={styles.tabBody}>
      {/* Live preview: shows the icon (in the accent color if both
          are set) next to the project name. Mirrors how the project
          renders in the sidebar so the user can see changes immediately
          without leaving the modal. */}
      <div
        className={styles.preview}
        style={
          appearance.accent
            ? { borderLeftColor: appearance.accent }
            : undefined
        }
      >
        <span
          className={styles.previewIcon}
          style={appearance.accent ? { color: appearance.accent } : undefined}
        >
          {appearance.icon ? (
            <DynamicIcon
              name={
                appearance.icon as Parameters<typeof DynamicIcon>[0]["name"]
              }
              size={20}
            />
          ) : (
            <Folder size={20} />
          )}
        </span>
        <span className={styles.previewName}>
          {projectName ?? "Project preview"}
        </span>
      </div>
      <Text variant="muted" size="xs" className={styles.tabHint}>
        Changes save instantly. The icon shows in the sidebar; the
        background tint and pattern apply to the project landing view.
      </Text>
      <AccentColorPicker
        value={appearance.accent}
        onChange={(accent) => patch({ accent })}
      />
      <LucideIconPicker
        value={appearance.icon}
        onChange={(icon) => patch({ icon })}
      />
      <BannerControl
        bannerUrl={bannerUrl}
        onUpload={uploadBanner}
        onDelete={deleteBanner}
      />
      <BackgroundControl
        value={appearance.background}
        onChange={(background) => patch({ background })}
      />
    </div>
  );
}
