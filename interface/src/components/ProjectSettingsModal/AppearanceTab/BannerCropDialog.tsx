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

export interface BannerCropResult {
  blob: Blob;
  /** When true, the user opted out of cropping. The image was
   *  uploaded at its native aspect and the consumer should mirror
   *  that on `appearance.bannerScaleToFit` so the rendering
   *  surfaces switch `object-fit` accordingly. */
  scaleToFit: boolean;
}

interface BannerCropDialogProps {
  isOpen: boolean;
  imageSrc: string;
  onConfirm: (result: BannerCropResult) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Read the raw image at `imageSrc` and re-encode as a PNG blob via
 * an offscreen canvas. Used for the scale-to-fit path so the
 * uploaded asset stays a PNG matching the rest of the banner
 * pipeline; preserves the source's native aspect (no cropping) and
 * caps the output's longest edge so we don't ship 20-megapixel
 * originals.
 */
async function reencodeForScaleToFit(imageSrc: string): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${imageSrc}`));
    img.src = imageSrc;
  });
  // Cap the longest edge so very large originals don't bloat the
  // upload. Aspect is preserved either way.
  const MAX_EDGE = 2000;
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("failed to acquire 2d canvas context");
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    );
  });
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
  const [scaleToFit, setScaleToFit] = useState(false);

  // Reset every time a fresh image source loads so the previous
  // crop/zoom/mode doesn't bleed into a re-pick.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setError(null);
    setScaleToFit(false);
  }, [imageSrc]);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const blob = scaleToFit
        ? await reencodeForScaleToFit(imageSrc)
        : croppedArea
          ? await cropImageToBlob(
              imageSrc,
              croppedArea,
              BANNER_OUTPUT_W,
              BANNER_OUTPUT_H,
              "image/png",
            )
          : null;
      if (!blob) {
        // Cropper hasn't reported a region yet; nothing to save.
        return;
      }
      await onConfirm({ blob, scaleToFit });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [croppedArea, imageSrc, onConfirm, onClose, scaleToFit]);

  const canConfirm = scaleToFit || !!croppedArea;

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
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={saving || !canConfirm}
          >
            {saving ? "Saving…" : scaleToFit ? "Save banner" : "Save banner"}
          </Button>
        </div>
      }
    >
      <div className={styles.cropContainer}>
        {imageSrc && !scaleToFit && (
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
        {/* Scale-to-fit preview: show the entire image letterboxed
            inside the same crop container so the user sees what the
            uploaded asset will look like. Replaces the interactive
            Cropper; the original is uploaded at its native aspect. */}
        {imageSrc && scaleToFit && (
          <img
            src={imageSrc}
            alt="Banner preview"
            className={styles.fitPreview}
          />
        )}
      </div>
      <div className={styles.controls}>
        <label className={styles.scaleToFitLabel}>
          <input
            type="checkbox"
            checked={scaleToFit}
            onChange={(e) => setScaleToFit(e.target.checked)}
          />
          <span>Scale to fit (no crop)</span>
        </label>
        {!scaleToFit && (
          <>
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
          </>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </Modal>
  );
}
