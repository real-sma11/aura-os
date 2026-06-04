import { Panel } from "@cypher-asi/zui";
import { PresetsPanel } from "../PresetsPanel";
import styles from "../AppearanceSection.module.css";

export function PresetsPane() {
  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-presets-panel"
    >
      <PresetsPanel />
    </Panel>
  );
}
