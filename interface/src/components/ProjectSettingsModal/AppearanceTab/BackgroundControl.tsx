import { type ChangeEvent } from "react";
import { Select, Text } from "@cypher-asi/zui";
import type { ProjectAppearance } from "../../../shared/api/appearance";
import styles from "./AppearanceTab.module.css";

type Pattern = NonNullable<NonNullable<ProjectAppearance["background"]>["pattern"]>;

const PATTERN_OPTIONS: { value: Pattern; label: string }[] = [
  { value: "none", label: "None" },
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
  { value: "diagonal", label: "Diagonal lines" },
  { value: "noise", label: "Noise" },
  { value: "radial", label: "Radial gradient" },
];

interface BackgroundControlProps {
  value: ProjectAppearance["background"];
  onChange: (next: ProjectAppearance["background"]) => void;
}

/**
 * Background tint + pattern + opacity. Writes through to the parent
 * (which composes the partial into a full appearance object before
 * persisting), so individual fields can be cleared by passing
 * `undefined` without rebuilding the whole object here.
 */
export function BackgroundControl({ value, onChange }: BackgroundControlProps) {
  const background = value ?? {};
  const color = background.color ?? "";
  const pattern: Pattern = background.pattern ?? "none";
  const opacity = typeof background.opacity === "number" ? background.opacity : 0.4;

  const update = (next: ProjectAppearance["background"]) => {
    // Collapse to `undefined` when every nested field is empty so we
    // don't leave a `background: {}` ghost in the persisted JSON.
    if (!next || (!next.color && (!next.pattern || next.pattern === "none") && next.opacity == null)) {
      onChange(undefined);
      return;
    }
    onChange(next);
  };

  const handleColor = (e: ChangeEvent<HTMLInputElement>) => {
    update({ ...background, color: e.target.value.toLowerCase() });
  };

  const handleClearColor = () => {
    const { color: _color, ...rest } = background;
    void _color;
    update(rest);
  };

  const handlePattern = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Pattern;
    update({ ...background, pattern: next });
  };

  const handleOpacity = (e: ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    update({ ...background, opacity: Number.isFinite(num) ? num : undefined });
  };

  return (
    <div className={styles.controlGroup}>
      <Text variant="muted" size="sm" className={styles.sectionLabel}>
        Background
      </Text>

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Color</span>
        <input
          type="color"
          value={color || "#1a1a1a"}
          onChange={handleColor}
          className={styles.nativeColorInput}
          aria-label="Pick background color"
        />
        {color && (
          <button
            type="button"
            className={styles.miniButton}
            onClick={handleClearColor}
          >
            Clear
          </button>
        )}
      </div>

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Pattern</span>
        <Select value={pattern} onChange={handlePattern}>
          {PATTERN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className={styles.bgRow}>
        <span className={styles.bgRowLabel}>Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={handleOpacity}
          className={styles.opacitySlider}
          aria-label="Background pattern opacity"
        />
        <span className={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
      </div>
    </div>
  );
}
