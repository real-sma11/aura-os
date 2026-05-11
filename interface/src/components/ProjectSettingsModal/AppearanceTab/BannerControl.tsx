import { useRef, useState, type ChangeEvent } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { BannerCropDialog } from "./BannerCropDialog";
import styles from "./AppearanceTab.module.css";

interface BannerControlProps {
  /** Current banner URL with cache-bust query param, from
   *  `useProjectAppearance().bannerUrl`. The `<img>` falls back to a
   *  "no banner" placeholder when the URL 404s. */
  bannerUrl: string;
  onUpload: (blob: Blob) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function BannerControl({ bannerUrl, onUpload, onDelete }: BannerControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedSrc, setPickedSrc] = useState<string | null>(null);
  const [hasBanner, setHasBanner] = useState(true);
  const [removing, setRemoving] = useState(false);

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset the input so re-picking the same file fires
    // another change event.
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      alert("Banner must be a PNG or JPEG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPickedSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = async (blob: Blob) => {
    await onUpload(blob);
    // Force the preview to re-evaluate the new URL — the bannerUrl
    // already cache-busts on upload, but resetting the local error
    // state ensures the `<img>` re-renders.
    setHasBanner(true);
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onDelete();
      setHasBanner(false);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={styles.controlGroup}>
      <div className={styles.iconHeader}>
        <Text variant="muted" size="sm" className={styles.sectionLabel}>
          Banner
        </Text>
      </div>

      <div className={styles.bannerPreview}>
        {hasBanner ? (
          // The same URL is the source of truth; an onError flips to
          // the placeholder branch so the "no banner" affordance shows
          // when the server has nothing to serve.
          <img
            src={bannerUrl}
            alt="Project banner"
            className={styles.bannerPreviewImg}
            onError={() => setHasBanner(false)}
            onLoad={() => setHasBanner(true)}
          />
        ) : (
          <div className={styles.bannerEmpty}>No banner set</div>
        )}
      </div>

      <div className={styles.bannerActions}>
        <Button variant="secondary" onClick={openFilePicker}>
          {hasBanner ? "Replace" : "Upload banner"}
        </Button>
        {hasBanner && (
          <Button
            variant="ghost"
            onClick={handleRemove}
            disabled={removing}
          >
            {removing ? "Removing…" : "Remove"}
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

      {pickedSrc && (
        <BannerCropDialog
          isOpen
          imageSrc={pickedSrc}
          onConfirm={handleConfirm}
          onClose={() => setPickedSrc(null)}
        />
      )}
    </div>
  );
}
