import { type ChangeEvent, useState } from "react";
import {
  Button,
  Panel,
  Text,
  useTheme,
  THEMES,
  ACCENT_COLORS,
  type Theme,
  type AccentColor,
} from "@cypher-asi/zui";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { useDesktopLogoColor } from "../../../hooks/use-desktop-logo-color";
import { CustomTokensPanel } from "./CustomTokensPanel";
import { PresetsPanel } from "./PresetsPanel";
import styles from "./AppearanceSection.module.css";

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const THEME_ICONS: Record<Theme, typeof Sun> = {
  dark: Moon,
  light: Sun,
  system: MonitorSmartphone,
};

const ACCENT_LABELS: Record<AccentColor, string> = {
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  green: "Green",
  orange: "Orange",
  rose: "Rose",
};

const SWATCH_CLASSES: Record<AccentColor, string> = {
  cyan: styles.swatchCyan,
  blue: styles.swatchBlue,
  purple: styles.swatchPurple,
  green: styles.swatchGreen,
  orange: styles.swatchOrange,
  rose: styles.swatchRose,
};

export function AppearanceSection() {
  const { theme, resolvedTheme, accent, setTheme, setAccent } = useTheme();
  const { color: logoColor, setColor: setLogoColor } = useDesktopLogoColor();
  const defaultLogoHex = resolvedTheme === "light" ? "#000000" : "#ffffff";
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  const handleLogoColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setLogoColor(e.target.value.toLowerCase());
    setHexDraft(null);
  };

  const handleLogoHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      setLogoColor(undefined);
    } else if (isValidHex(trimmed)) {
      setLogoColor(trimmed.toLowerCase());
    }
  };

  const handleLogoHexBlur = () => setHexDraft(null);

  const handleLogoReset = () => {
    setLogoColor(undefined);
    setHexDraft(null);
  };

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.appearancePanel}
      data-testid="settings-appearance-panel"
    >
      <Text weight="semibold" size="sm">
        Appearance
      </Text>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Theme
        </Text>
        <div className={styles.themeButtons}>
          {THEMES.map((mode) => {
            const Icon = THEME_ICONS[mode];
            return (
              <Button
                key={mode}
                size="sm"
                variant={theme === mode ? "filled" : "ghost"}
                icon={<Icon size={14} />}
                fullWidth
                onClick={() => setTheme(mode)}
              >
                {THEME_LABELS[mode]}
              </Button>
            );
          })}
        </div>
      </div>

      <div className={styles.section}>
        <Text variant="muted" size="sm">
          Accent color
        </Text>
        <div className={styles.accentSwatches}>
          {ACCENT_COLORS.map((color) => {
            const isSelected = accent === color;
            const swatchClass = `${styles.swatch} ${SWATCH_CLASSES[color]}${isSelected ? ` ${styles.swatchSelected}` : ""}`;
            return (
              <button
                key={color}
                type="button"
                className={swatchClass}
                onClick={() => setAccent(color)}
                aria-label={ACCENT_LABELS[color]}
                aria-pressed={isSelected}
                title={ACCENT_LABELS[color]}
              />
            );
          })}
        </div>
      </div>

      <CustomTokensPanel />

      <Text variant="muted" size="xs">
        Custom colors persist per dark/light mode in this browser.
      </Text>

      <PresetsPanel />

      <div className={styles.logoSection}>
        <Text weight="semibold" size="sm">
          Aura Logo
        </Text>
        <Text variant="muted" size="xs">
          Customize the wordmark color in the desktop title bar.
        </Text>
        <div className={styles.logoColorRow}>
          <input
            type="color"
            value={logoColor || defaultLogoHex}
            onChange={handleLogoColorPicker}
            className={styles.logoColorInput}
            aria-label="Pick logo color"
          />
          <input
            type="text"
            value={hexDraft ?? logoColor}
            onChange={handleLogoHexChange}
            onBlur={handleLogoHexBlur}
            placeholder={defaultLogoHex}
            className={styles.logoHexInput}
            aria-label="Logo color hex value"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.logoResetButton}
            onClick={handleLogoReset}
            disabled={!logoColor}
          >
            Reset
          </button>
        </div>
        <div className={styles.logoPreview}>
          <div
            className={styles.logoPreviewMark}
            role="img"
            aria-label="AURA logo preview"
            style={{ backgroundColor: logoColor || defaultLogoHex }}
          />
        </div>
      </div>
    </Panel>
  );
}
