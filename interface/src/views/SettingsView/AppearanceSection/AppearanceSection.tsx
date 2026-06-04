import { THEME_SUB_AREAS } from "./themeSubAreas";
import styles from "./AppearanceSection.module.css";

/**
 * Full Theme settings page used by the route-based `SettingsView` and mobile.
 * Stacks every Theme sub-area pane on a single scroll. The desktop Settings
 * modal (`OrgSettingsPanel`) renders these same panes one at a time behind a
 * drill-down "<- Settings > Theme" breadcrumb instead.
 */
export function AppearanceSection() {
  return (
    <div className={styles.sectionStack} data-testid="settings-appearance">
      {THEME_SUB_AREAS.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </div>
  );
}
