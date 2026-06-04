import { useCallback, useRef, useState } from "react";
import { Button, Panel, Text, useTheme } from "@cypher-asi/zui";
import { Upload } from "lucide-react";
import {
  useDesktopBackgroundStore,
  type BackgroundConfig,
  type ThemeSlot,
} from "../../../../stores/desktop-background-store";
import appearanceStyles from "../AppearanceSection.module.css";
import styles from "./BackgroundPane.module.css";

const PRESET_COLORS = [
  "#ffffff", "#000000",
  "#1a1a2e", "#16213e", "#0f3460", "#533483",
  "#2b2d42", "#3a0ca3", "#264653", "#2d6a4f",
  "#774936", "#6b2737", "#403d39", "#212529",
];

type BackgroundView = "color" | "image";

function BackgroundConfig({
  title,
  theme,
  config,
  defaultCustomColor,
}: {
  title: string;
  theme: ThemeSlot;
  config: BackgroundConfig;
  defaultCustomColor: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const setColor = useDesktopBackgroundStore((s) => s.setColor);
  const setImage = useDesktopBackgroundStore((s) => s.setImage);

  const [view, setView] = useState<BackgroundView>(
    config.mode === "image" ? "image" : "color",
  );

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImage(theme, reader.result);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [setImage, theme],
  );

  const { mode, color, imageDataUrl } = config;

  return (
    <div className={appearanceStyles.section}>
      <div
        className={styles.typeToggle}
        role="tablist"
        aria-label={`${title} background type`}
      >
        <Button
          size="sm"
          variant={view === "color" ? "filled" : "ghost"}
          fullWidth
          onClick={() => setView("color")}
          role="tab"
          aria-selected={view === "color"}
        >
          Color
        </Button>
        <Button
          size="sm"
          variant={view === "image" ? "filled" : "ghost"}
          fullWidth
          onClick={() => setView("image")}
          role="tab"
          aria-selected={view === "image"}
        >
          Image
        </Button>
      </div>

      {view === "color" && (
        <div className={appearanceStyles.section}>
          <div className={styles.swatches}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.swatch} ${mode === "color" && color === c ? styles.swatchActive : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(theme, c)}
                aria-label={`Set ${title.toLowerCase()} to ${c}`}
              />
            ))}
          </div>
          <div className={styles.customColorRow}>
            <input
              type="color"
              className={styles.colorInput}
              value={mode === "color" && color ? color : defaultCustomColor}
              onChange={(e) => setColor(theme, e.target.value)}
              aria-label={`Custom ${title.toLowerCase()} color`}
            />
            <Text variant="muted" size="sm">
              Custom color
            </Text>
          </div>
        </div>
      )}

      {view === "image" && (
        <div className={appearanceStyles.section}>
          {mode === "image" && imageDataUrl && (
            <img
              src={imageDataUrl}
              alt={`${title} preview`}
              className={styles.imagePreview}
              loading="lazy"
              decoding="async"
            />
          )}
          <div className={styles.imageActions}>
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload size={14} />}
              onClick={() => fileRef.current?.click()}
            >
              Choose Image
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFile}
          />
        </div>
      )}
    </div>
  );
}

export function BackgroundPane() {
  const light = useDesktopBackgroundStore((s) => s.light);
  const dark = useDesktopBackgroundStore((s) => s.dark);
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={appearanceStyles.appearancePanel}
      data-testid="settings-background-panel"
    >
      <Text weight="semibold" size="sm">
        Desktop background
      </Text>
      <Text variant="muted" size="xs">
        Sets the wallpaper for {isLight ? "light" : "dark"} mode. Saved in this
        browser.
      </Text>

      {isLight ? (
        <BackgroundConfig
          title="Light mode"
          theme="light"
          config={light}
          defaultCustomColor="#ffffff"
        />
      ) : (
        <BackgroundConfig
          title="Dark mode"
          theme="dark"
          config={dark}
          defaultCustomColor="#000000"
        />
      )}
    </Panel>
  );
}
