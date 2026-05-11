import { useCallback } from "react";
import { DynamicIcon } from "lucide-react/dynamic";
import { Folder } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useProjectAppearance } from "../../../hooks/use-project-appearance";
import type { ProjectAppearance } from "../../../shared/api/appearance";
import { BackgroundControl } from "./BackgroundControl";
import { BannerControl } from "./BannerControl";
import { ColorPicker } from "./ColorPicker";
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
  const {
    appearance,
    update,
    uploadBanner,
    deleteBanner,
    bannerUrl,
    backgroundImageUrl,
    uploadBackgroundImage,
    deleteBackgroundImage,
  } = useProjectAppearance(projectId);

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
        // Mirror the sidebar row treatment exactly: outline takes
        // priority over the accent stripe (the two would otherwise
        // compete for the left edge). The stripe color is piped
        // through `--accent-stripe-color`; the actual painting is
        // done by `.preview::before` in the stylesheet so the
        // stripe stays straight inside the rounded chip.
        style={
          {
            background: appearance.headerBackground,
            border: appearance.headerOutline
              ? `1px solid ${appearance.headerOutline}`
              : undefined,
            ...(appearance.accent &&
            !appearance.headerOutline &&
            !appearance.headerBackground
              ? { ["--accent-stripe-color" as string]: appearance.accent }
              : {}),
          } as React.CSSProperties
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
        <span
          className={styles.previewName}
          style={
            appearance.nameColor ? { color: appearance.nameColor } : undefined
          }
        >
          {projectName ?? "Project preview"}
        </span>
      </div>
      <Text variant="muted" size="xs" className={styles.tabHint}>
        Changes save instantly. The icon and name color show in the
        sidebar; the background tint and pattern apply to the project
        landing view.
      </Text>
      <ColorPicker
        label="Accent color"
        noun="accent"
        value={appearance.accent}
        onChange={(accent) => patch({ accent })}
      />
      <ColorPicker
        label="Project name color"
        noun="name color"
        value={appearance.nameColor}
        onChange={(nameColor) => patch({ nameColor })}
      />
      <ColorPicker
        label="Header background color"
        noun="header background"
        value={appearance.headerBackground}
        onChange={(headerBackground) => patch({ headerBackground })}
      />
      <ColorPicker
        label="Header outline color"
        noun="header outline"
        value={appearance.headerOutline}
        onChange={(headerOutline) => patch({ headerOutline })}
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
        backgroundImageUrl={backgroundImageUrl}
        onUploadImage={uploadBackgroundImage}
        onDeleteImage={deleteBackgroundImage}
      />
    </div>
  );
}
