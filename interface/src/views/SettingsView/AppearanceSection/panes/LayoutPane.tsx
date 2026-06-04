import { Button, Panel, Text } from "@cypher-asi/zui";
import { useLayout } from "../../../../hooks/use-theme-layout";
import { RADIUS_PRESETS, DENSITY_OPTIONS } from "../../../../lib/theme-layout";
import styles from "../AppearanceSection.module.css";

export function LayoutPane() {
  const { layout, setRadius, setDensity } = useLayout();

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-layout-panel"
    >
      <Text weight="semibold" size="sm">
        Layout & density
      </Text>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Corner radius
        </Text>
        <div className={styles.segmented}>
          {RADIUS_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant={layout.radius === preset.id ? "filled" : "ghost"}
              onClick={() => setRadius(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Density
        </Text>
        <div className={styles.segmented}>
          {DENSITY_OPTIONS.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={layout.density === option.id ? "filled" : "ghost"}
              onClick={() => setDensity(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Text variant="muted" size="xs">
          Compact tightens control heights for a denser interface. Saved in this
          browser.
        </Text>
      </div>
    </Panel>
  );
}
