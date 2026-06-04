import { Panel, Text, Toggle } from "@cypher-asi/zui";
import { useMotion } from "../../../../hooks/use-theme-motion";
import { MOTION_SPEED_MIN, MOTION_SPEED_MAX } from "../../../../lib/theme-motion";
import styles from "../AppearanceSection.module.css";

export function MotionPane() {
  const { motion, setReduceMotion, setSpeed } = useMotion();

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-motion-panel"
    >
      <Text weight="semibold" size="sm">
        Motion
      </Text>

      <div className={styles.section}>
        <Toggle
          label="Reduce motion"
          checked={motion.reduceMotion}
          onChange={(e) => setReduceMotion(e.target.checked)}
        />
        <Text variant="muted" size="xs">
          Minimizes transitions and animations across the interface.
        </Text>

        <div className={styles.slider}>
          <label className={styles.sliderLabel} htmlFor="motion-speed">
            <Text size="sm">Transition speed</Text>
            <Text variant="muted" size="xs">
              {motion.speed}%
            </Text>
          </label>
          <input
            id="motion-speed"
            type="range"
            className={styles.sliderInput}
            min={MOTION_SPEED_MIN}
            max={MOTION_SPEED_MAX}
            step={5}
            value={motion.speed}
            aria-label="Transition speed"
            disabled={motion.reduceMotion}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </div>
        <Text variant="muted" size="xs">
          Higher is snappier. Disabled while reduce motion is on.
        </Text>
      </div>
    </Panel>
  );
}
