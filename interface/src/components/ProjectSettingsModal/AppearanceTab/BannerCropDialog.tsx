import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button, Modal } from "@cypher-asi/zui";
import { cropImageToBlob } from "../../../shared/utils/crop-to-blob";
import styles from "./BannerCropDialog.module.css";

/**
 * Banner output resolution at the chosen 16:5 aspect. Big enough for
 * a hero display on a high-DPI screen without producing megabyte-class
 * files; small enough that the 5 MiB server cap won't bite. The
 * cropper renders at any aspect, but we fix the output to keep
 * downstream layout predictable.
 */
const BANNER_ASPECT = 16 / 5;
const BANNER_OUTPUT_W = 1600;
const BANNER_OUTPUT_H = 500;

interface BannerCropDialogProps {
  isOpen: boolean;
  imageSrc: string;
  onConfirm: (blob: Blob) => Promise<void> | void;
  onClose: () => void;
}

export function BannerCropDialog({
  isOpen,
  imageSrc,
  onConfirm,
  onClose,
}: BannerCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time a fresh image source loads so the previous
  // crop/zoom doesn't bleed into a re-pick.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setError(null);
  }, [imageSrc]);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!croppedArea) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await cropImageToBlob(
        imageSrc,
        croppedArea,
        BANNER_OUTPUT_W,
        BANNER_OUTPUT_H,
        "image/png",
      );
      await onConfirm(blob);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [croppedArea, imageSrc, onConfirm, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Crop banner"
      size="md"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={saving || !croppedArea}>
            {saving ? "Saving…" : "Save banner"}
          </Button>
        </div>
      }
    >
      <div className={styles.cropContainer}>
        {imageSrc && (
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={0.5}
            aspect={BANNER_ASPECT}
            cropShape="rect"
            showGrid={false}
            restrictPosition={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        )}
      </div>
      <div className={styles.controls}>
        <span className={styles.zoomLabel}>Zoom</span>
        <input
          type="range"
          className={styles.zoomSlider}
          min={0.5}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </Modal>
  );
}
