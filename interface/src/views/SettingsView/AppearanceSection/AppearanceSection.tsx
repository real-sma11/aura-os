import { THEME_SUB_AREAS, groupThemeSubAreas } from "./themeSubAreas";
import styles from "./AppearanceSection.module.css";

/**
 * Full Theme settings page used by the route-based `SettingsView` and mobile.
 * Stacks every Theme sub-area pane on a single scroll, under the same logical
 * group headers the desktop modal's drill-down sub-nav uses. The modal
 * (`OrgSettingsPanel`) renders these same panes one at a time behind a
 * drill-down "<- Settings > Theme" breadcrumb instead.
 */
export function AppearanceSection() {
  const groups = groupThemeSubAreas(THEME_SUB_AREAS);
  return (
    <div className={styles.sectionStack} data-testid="settings-appearance">
      {groups.map(({ group, items }) => (
        <section key={group} className={styles.sectionGroup}>
          <h3 className={styles.sectionGroupLabel}>{group}</h3>
          {items.map(({ id, Component }) => (
            <Component key={id} />
          ))}
        </section>
      ))}
    </div>
  );
}
