import { type ChangeEvent } from "react";
import { Input, Text } from "@cypher-asi/zui";
import styles from "./AppearanceTab.module.css";

/**
 * Curated swatch palette shown above the freeform hex input. Each
 * swatch is one click instead of dragging through the native colour
 * picker — most users will pick a project colour from a small set,
 * and the swatches double as visual anchors in dark and light
 * themes. Tuned to feel "vivid but not neon" on both themes.
 */
const ACCENT_SWATCHES = [
  "#7c3aed", // violet
  "#2563eb", // blue
  "#0891b2", // cyan
  "#059669", // emerald
  "#65a30d", // lime
  "#ca8a04", // amber
  "#ea580c", // orange
  "#dc2626", // red
  "#db2777", // pink
  "#94a3b8", // slate
];

interface AccentColorPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

/** True if `value` parses as a six-digit hex (with leading `#`). */
function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function AccentColorPicker({ value, onChange }: AccentColorPickerProps) {
  const current = value ?? "";

  const handleHexInput = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw === "") {
      onChange(undefined);
      return;
    }
    // Only commit on valid hex so we don't push half-typed values
    // through to the live preview / server. Invalid intermediate
    // states still display in the input — we let the user finish
    // typing.
    if (isValidHex(raw)) {
      onChange(raw.toLowerCase());
    }
  };

  const handleNativePicker = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value.toLowerCase());
  };

  return (
    <div className={styles.controlGroup}>
      <Text variant="muted" size="sm" className={styles.sectionLabel}>
        Accent color
      </Text>
      <div className={styles.swatchRow}>
        {ACCENT_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className={`${styles.swatch} ${current.toLowerCase() === hex ? styles.swatchActive : ""}`}
            style={{ background: hex }}
            onClick={() => onChange(hex)}
            title={hex}
            aria-label={`Use accent ${hex}`}
          />
        ))}
        <button
          type="button"
          className={`${styles.swatch} ${styles.swatchClear}`}
          onClick={() => onChange(undefined)}
          title="Clear accent"
          aria-label="Clear accent"
        >
          ✕
        </button>
      </div>
      <div className={styles.hexRow}>
        <input
          type="color"
          value={current || "#7c3aed"}
          onChange={handleNativePicker}
          className={styles.nativeColorInput}
          aria-label="Pick custom accent color"
        />
        <Input
          value={current}
          onChange={handleHexInput}
          placeholder="#7c3aed"
        />
      </div>
    </div>
  );
}
