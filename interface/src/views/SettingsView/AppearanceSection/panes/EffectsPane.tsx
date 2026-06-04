import { Panel, Text, Toggle } from "@cypher-asi/zui";
import { usePanelGlass } from "../../../../hooks/use-panel-glass";
import { useGlassLevel } from "../../../../hooks/use-glass-level";
import type { PanelKey } from "../../../../lib/panel-glass";
import {
  GLASS_BLUR_MIN,
  GLASS_BLUR_MAX,
  GLASS_OPACITY_MIN,
  GLASS_OPACITY_MAX,
} from "../../../../lib/glass-level";
import styles from "../AppearanceSection.module.css";

const GLASS_PANELS: { key: PanelKey; label: string }[] = [
  { key: "left", label: "Glass left panel" },
  { key: "middle", label: "Glass main panel" },
  { key: "sidekick", label: "Glass sidekick" },
];

export function EffectsPane() {
  const { glass, setPanel } = usePanelGlass();
  const { level, setBlur, setOpacity } = useGlassLevel();

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-effects-panel"
    >
      <Text weight="semibold" size="sm">
        Effects
      </Text>

      <div className={styles.section}>
        {GLASS_PANELS.map(({ key, label }) => (
          <Toggle
            key={key}
            label={label}
            checked={glass[key]}
            onChange={(e) => setPanel(key, e.target.checked)}
          />
        ))}
        <Text variant="muted" size="xs">
          Frosts each panel so the wallpaper shows through behind it.
        </Text>

        <div className={styles.slider}>
          <label className={styles.sliderLabel} htmlFor="glass-blur">
            <Text size="sm">Blur</Text>
            <Text variant="muted" size="xs">
              {level.blur}px
            </Text>
          </label>
          <input
            id="glass-blur"
            type="range"
            className={styles.sliderInput}
            min={GLASS_BLUR_MIN}
            max={GLASS_BLUR_MAX}
            step={1}
            value={level.blur}
            aria-label="Glass blur"
            onChange={(e) => setBlur(Number(e.target.value))}
          />
        </div>

        <div className={styles.slider}>
          <label className={styles.sliderLabel} htmlFor="glass-opacity">
            <Text size="sm">Opacity</Text>
            <Text variant="muted" size="xs">
              {level.opacity}%
            </Text>
          </label>
          <input
            id="glass-opacity"
            type="range"
            className={styles.sliderInput}
            min={GLASS_OPACITY_MIN}
            max={GLASS_OPACITY_MAX}
            step={1}
            value={level.opacity}
            aria-label="Glass opacity"
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </div>
      </div>
    </Panel>
  );
}
