import { type ChangeEvent, useState, useId } from "react";
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
import { useDesktopLogoColor, type PulseMode } from "../../../hooks/use-desktop-logo-color";
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
  const {
    color: logoColor, setColor: setLogoColor,
    pulseEnabled, setPulseEnabled,
    pulseMode, setPulseMode,
    pulseSpeed, setPulseSpeed,
    pulseFromColor, setPulseFromColor,
    sweepReversed, setSweepReversed,
  } = useDesktopLogoColor();
  const defaultLogoHex = resolvedTheme === "light" ? "#000000" : "#ffffff";
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [fromHexDraft, setFromHexDraft] = useState<string | null>(null);
  const pulseCheckboxId = useId();
  const sweepReverseId = useId();

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

  const handleFromColorPicker = (e: ChangeEvent<HTMLInputElement>) => {
    setPulseFromColor(e.target.value.toLowerCase());
    setFromHexDraft(null);
  };

  const handleFromHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setFromHexDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === "") {
      setPulseFromColor(undefined);
    } else if (isValidHex(trimmed)) {
      setPulseFromColor(trimmed.toLowerCase());
    }
  };

  const handleFromHexBlur = () => setFromHexDraft(null);

  const handleFromReset = () => {
    setPulseFromColor(undefined);
    setFromHexDraft(null);
  };

  const effectiveFromColor = pulseFromColor || defaultLogoHex;
  const effectiveToColor = logoColor || defaultLogoHex;

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

        {/* Logo color */}
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

        {/* Pulse toggle */}
        <div className={styles.pulseToggleRow}>
          <input
            type="checkbox"
            id={pulseCheckboxId}
            checked={pulseEnabled}
            onChange={(e) => setPulseEnabled(e.target.checked)}
            className={styles.pulseCheckbox}
          />
          <label htmlFor={pulseCheckboxId} className={styles.pulseLabel}>
            Pulse
          </label>
        </div>

        {/* Pulse settings — revealed when enabled */}
        {pulseEnabled && (
          <div className={styles.pulseSettings}>
            {/* Mode */}
            <Text variant="muted" size="xs">Mode</Text>
            <div className={styles.pulseModeRow}>
              {(["fade", "sweep"] as PulseMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`${styles.pulseModeButton}${pulseMode === m ? ` ${styles.pulseModeButtonActive}` : ""}`}
                  onClick={() => setPulseMode(m)}
                >
                  {m === "fade" ? "Fade" : "Sweep"}
                </button>
              ))}
            </div>

            {/* Sweep direction — only shown in sweep mode */}
            {pulseMode === "sweep" && (
              <div className={styles.pulseToggleRow}>
                <input
                  type="checkbox"
                  id={sweepReverseId}
                  checked={sweepReversed}
                  onChange={(e) => setSweepReversed(e.target.checked)}
                  className={styles.pulseCheckbox}
                />
                <label htmlFor={sweepReverseId} className={styles.pulseLabel}>
                  Reverse direction
                </label>
              </div>
            )}

            {/* Speed */}
            <Text variant="muted" size="xs">Speed</Text>
            <div className={styles.pulseSpeedRow}>
              <Text variant="muted" size="xs">Fast</Text>
              <input
                type="range"
                min="0.5"
                max="30"
                step="0.1"
                value={pulseSpeed}
                onChange={(e) => setPulseSpeed(parseFloat(e.target.value))}
                className={styles.pulseSpeedSlider}
                aria-label="Pulse speed"
              />
              <Text variant="muted" size="xs">Slow</Text>
              <Text variant="muted" size="xs" className={styles.pulseSpeedValue}>
                {pulseSpeed.toFixed(1)}s
              </Text>
            </div>

            {/* Pulse-from color */}
            <Text variant="muted" size="xs">Pulse from</Text>
            <div className={styles.logoColorRow}>
              <input
                type="color"
                value={pulseFromColor || defaultLogoHex}
                onChange={handleFromColorPicker}
                className={styles.logoColorInput}
                aria-label="Pick pulse-from color"
              />
              <input
                type="text"
                value={fromHexDraft ?? pulseFromColor}
                onChange={handleFromHexChange}
                onBlur={handleFromHexBlur}
                placeholder={defaultLogoHex}
                className={styles.logoHexInput}
                aria-label="Pulse-from color hex value"
                spellCheck={false}
              />
              <button
                type="button"
                className={styles.logoResetButton}
                onClick={handleFromReset}
                disabled={!pulseFromColor}
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Preview */}
        <div className={styles.logoPreview}>
          {!pulseEnabled ? (
            <div
              className={styles.logoPreviewMark}
              role="img"
              aria-label="AURA logo preview"
              style={{ backgroundColor: effectiveToColor }}
            />
          ) : pulseMode === "fade" ? (
            <div
              className={`${styles.logoPreviewMark} ${styles.logoPreviewPulseFade}`}
              role="img"
              aria-label="AURA logo preview"
              style={{
                "--logo-pulse-from": effectiveFromColor,
                "--logo-pulse-to": effectiveToColor,
                "--logo-pulse-duration": `${pulseSpeed}s`,
              } as React.CSSProperties}
            />
          ) : (
            <div className={styles.logoPreviewWrapper} role="img" aria-label="AURA logo preview">
              <div
                className={styles.logoPreviewMark}
                style={{ backgroundColor: effectiveFromColor }}
              />
              <div
                className={`${styles.logoPreviewMark} ${sweepReversed ? styles.logoPreviewSweepOverlayReversed : styles.logoPreviewSweepOverlay}`}
                style={{
                  backgroundColor: effectiveToColor,
                  "--logo-pulse-duration": `${pulseSpeed}s`,
                } as React.CSSProperties}
              />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
