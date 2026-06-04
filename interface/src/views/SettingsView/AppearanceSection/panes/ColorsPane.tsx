import { Panel } from "@cypher-asi/zui";
import { CustomTokensPanel } from "../CustomTokensPanel";
import styles from "../AppearanceSection.module.css";

export function ColorsPane() {
  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-colors-panel"
    >
      <CustomTokensPanel />
    </Panel>
  );
}
