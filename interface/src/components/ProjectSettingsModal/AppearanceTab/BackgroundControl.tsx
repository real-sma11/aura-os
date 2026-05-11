import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button, Select, Text } from "@cypher-asi/zui";
import type { ProjectAppearance } from "../../../shared/api/appearance";
import styles from "./AppearanceTab.module.css";

type Pattern = NonNullable<NonNullable<ProjectAppearance["background"]>["pattern"]>;

const PATTERN_OPTIONS: { value: Pattern; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
  { value: "diagonal", label: "Diagonal lines" },
  { value: "noise", label: "Noise" },
  { value: "radial", label: "Radial gradient" },
  { value: "image", label: "Image" },
];

interface BackgroundControlProps {
  value: ProjectAppearance["background"];
  onChange: (next: ProjectAppearance["background"]) => void;
  /** Token-stamped GET URL for the project's uploaded background
   *  image, from `useProjectAppearance().backgroundImageUrl`. Used as
   *  the `<img src>` for the preview when `pattern === "image"`. */
  backgroundImageUrl: string;
  onUploadImage: (blob: Blob) => Promise<void>;
  onDeleteImage: () => Promise<void>;
}

/**
 * Background tint + pattern + opacity + optional uploaded image.
 * Writes through to the parent (which composes the partial into a
 * full appearance object before persisting), so individual fields can
 * be cleared by passing `undefined` without rebuilding the whole
 * object here. The Clear button at the section header wipes the
 * entire `background` block to revert to the Aura default.
 */
export function BackgroundControl({
  value,
  onChange,
  backgroundImageUrl,
  onUploadImage,
  onDeleteImage,
}: BackgroundControlProps) {
  const background = value ?? {};
  const color = background.color ?? "";
  // Legacy `none` reads through as `solid` so existing saves still
  // render under the new dropdown labels — the two are visually
  // identical (color-only, no overlay).
  const rawPattern = background.pattern ?? "solid";
  const pattern: Pattern = rawPattern === "none" ? "solid" : rawPattern;
  const opacity = typeof background.opacity === "number" ? background.opacity : 1;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasImage, setHasImage] = useState(true);
  const [removingImage, setRemovingImage] = useState(false);
  // Reset the "did this URL load?" probe whenever the cache-bust
  // version flips. Without this, an initial 404 (no image uploaded
  // yet) would unmount the `<img>` and a subsequent upload would never
  // get attempted. Mirrors the same pattern in `BannerControl`.
  useEffect(() => {
    setHasImage(true);
  }, [backgroundImageUrl]);

  const update = (next: ProjectAppearance["background"]) => {
    // Collapse to `undefined` when every nested field is empty so we
    // don't leave a `background: {}` ghost in the persisted JSON.
    if (
      !next ||
      (!next.color &&
        (!next.pattern || next.pattern === "solid" || next.pattern === "none") &&
        next.opacity == null)
    ) {
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

  const handleToggleInvert = () => {
    const next = !background.invert;
    // Store `true` explicitly; drop the key when off so the persisted
    // JSON stays minimal on the common path.
    if (next) {
      update({ ...background, invert: true });
    } else {
      const { invert: _, ...rest } = background;
      void _;
      update(rest);
    }
  };

  const invert = background.invert === true;
  // Solid has nothing to invert; hide the toggle in that case so the
  // user isn't presented with a control that does nothing.
  const canInvert = pattern !== "solid";

  // Hard reset: drop the entire `background` field. Also deletes the
  // uploaded image so the project genuinely reverts to the Aura
  // default and there's no orphaned `background.png` left behind in
  // `.aura/`.
  const handleClearBackground = () => {
    onChange(undefined);
    void onDeleteImage().catch((err) => {
      console.warn("Failed to delete background image on clear:", err);
    });
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      alert("Background image must be a PNG or JPEG.");
      return;
    }
    void onUploadImage(file).catch((err) => {
      console.warn("Failed to upload background image:", err);
    });
  };

  const handleRemoveImage = async () => {
    setRemovingImage(true);
    try {
      await onDeleteImage();
    } finally {
      setRemovingImage(false);
    }
  };

  return (
    <div className={styles.controlGroup}>
      <div className={styles.iconHeader}>
        <Text variant="muted" size="sm" className={styles.sectionLabel}>
          Background
        </Text>
        <button
          type="button"
          className={styles.miniButton}
          onClick={handleClearBackground}
        >
          Clear
        </button>
      </div>

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
        <span className={styles.bgRowLabel}>Style</span>
        <Select value={pattern} onChange={handlePattern}>
          {PATTERN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        {canInvert && (
          <button
            type="button"
            className={`${styles.miniButton} ${invert ? styles.miniButtonActive : ""}`}
            onClick={handleToggleInvert}
            title={
              pattern === "image" || pattern === "noise"
                ? "Invert image colors"
                : "Swap pattern figure/ground"
            }
            aria-pressed={invert}
          >
            Invert
          </button>
        )}
      </div>

      {pattern === "image" && (
        <div className={styles.bgImageBlock}>
          <div className={styles.bgImagePreview}>
            {hasImage ? (
              <img
                src={backgroundImageUrl}
                alt="Project background"
                className={styles.bgImagePreviewImg}
                onError={() => setHasImage(false)}
                onLoad={() => setHasImage(true)}
              />
            ) : (
              <div className={styles.bannerEmpty}>No image uploaded</div>
            )}
          </div>
          <div className={styles.bannerActions}>
            <Button variant="secondary" onClick={openFilePicker}>
              {hasImage ? "Replace image" : "Upload image"}
            </Button>
            {hasImage && (
              <Button
                variant="ghost"
                onClick={handleRemoveImage}
                disabled={removingImage}
              >
                {removingImage ? "Removing…" : "Remove image"}
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </div>
        </div>
      )}

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
          aria-label="Background opacity"
        />
        <span className={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
      </div>
    </div>
  );
}
