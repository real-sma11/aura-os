import type { MutableRefObject, Ref } from "react";
import { Lane, type LaneResizeControls } from "../Lane";
import {
  SIDEKICK_MAX_WIDTH,
  SIDEKICK_MIN_WIDTH,
} from "./desktop-shell-sidekick";
import styles from "./DesktopShell.module.css";

interface PersistentSidekickLaneProps {
  collapsed: boolean;
  defaultWidth: number;
  showHeaderSlot: boolean;
  maxWidth?: number;
  laneRef?: Ref<HTMLDivElement>;
  resizeControlsRef?: MutableRefObject<LaneResizeControls | null>;
  onResize?: (size: number) => void;
  onResizeStart?: () => void;
  onResizeEnd: (size: number) => void;
  onHeaderTargetChange: (node: HTMLDivElement | null) => void;
  onPanelTargetChange: (node: HTMLDivElement | null) => void;
}

export function PersistentSidekickLane({
  collapsed,
  defaultWidth,
  showHeaderSlot,
  maxWidth = SIDEKICK_MAX_WIDTH,
  laneRef,
  resizeControlsRef,
  onResize,
  onResizeStart,
  onResizeEnd,
  onHeaderTargetChange,
  onPanelTargetChange,
}: PersistentSidekickLaneProps) {
  return (
    <Lane
      ref={laneRef}
      resizable
      resizePosition="left"
      defaultWidth={defaultWidth}
      minWidth={SIDEKICK_MIN_WIDTH}
      maxWidth={maxWidth}
      storageKey={null}
      collapsible
      collapsed={collapsed}
      resizeControlsRef={resizeControlsRef}
      onResizeStart={onResizeStart}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      className={styles.sidekickLane}
      header={
        showHeaderSlot ? (
          <div
            ref={onHeaderTargetChange}
            className={styles.sidekickHeaderSlot}
            data-agent-surface="sidekick-header"
            aria-label="Sidekick header"
          />
        ) : undefined
      }
    >
      <div className={styles.sidekickPanels}>
        <div
          ref={onPanelTargetChange}
          className={styles.sidekickPanelSlot}
          data-agent-surface="sidekick-panel"
          aria-label="Sidekick panel"
        />
      </div>
    </Lane>
  );
}
