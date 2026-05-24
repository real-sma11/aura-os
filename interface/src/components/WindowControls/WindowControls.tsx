import { Button, ButtonWindow } from "@cypher-asi/zui";
import { Columns2, PanelRight } from "lucide-react";
import { windowCommand } from "../../lib/windowCommand";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./WindowControls.module.css";

interface WindowControlsProps {
  sidekickCollapsed?: boolean;
  onToggleSidekick?: () => void;
  splitScreenActive?: boolean;
  onToggleSplitScreen?: () => void;
}

export function WindowControls({
  sidekickCollapsed,
  onToggleSidekick,
  splitScreenActive = false,
  onToggleSplitScreen,
}: WindowControlsProps = {}) {
  const { features } = useAuraCapabilities();
  const showSidekickToggle = typeof onToggleSidekick === "function";
  const showSplitToggle = typeof onToggleSplitScreen === "function";

  if (!features.windowControls && !showSidekickToggle && !showSplitToggle) return null;

  return (
    <div className={`titlebar-no-drag ${styles.controlRow}`}>
      {showSplitToggle ? (
        <Button
          variant="ghost"
          size="sm"
          rounded="md"
          iconOnly
          selected={splitScreenActive}
          title="Split sidekick 50/50"
          aria-label="Toggle split screen"
          aria-pressed={splitScreenActive}
          className={styles.sidekickToggle}
          onClick={onToggleSplitScreen}
        >
          <Columns2 size={14} strokeWidth={2} />
        </Button>
      ) : null}
      {showSidekickToggle ? (
        <Button
          variant="ghost"
          size="sm"
          rounded="md"
          iconOnly
          selected={!sidekickCollapsed}
          title="Toggle sidekick"
          aria-label="Toggle sidekick"
          aria-pressed={!sidekickCollapsed}
          className={styles.sidekickToggle}
          onClick={onToggleSidekick}
        >
          <PanelRight size={14} strokeWidth={2} />
        </Button>
      ) : null}
      {features.windowControls ? (
        <>
          <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
          <ButtonWindow action="maximize" size="sm" className={styles.maximizeIcon} onClick={() => windowCommand("maximize")} />
          <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
        </>
      ) : null}
    </div>
  );
}
