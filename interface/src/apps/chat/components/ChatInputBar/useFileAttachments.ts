import { useCallback, useEffect, useRef } from "react";
import type { AttachmentItem } from "./ChatInputBar";
import { uploadFile } from "../../../../api/upload";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_MB = 5;
const MAX_TOTAL_SIZE_MB = 10;
const MAX_IMAGE_UPLOAD_BYTES = 1_100_000;
const MAX_IMAGE_DIMENSION = 1536;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/x-markdown"];
const TEXT_EXTENSIONS = [".md", ".txt", ".markdown"];

function isTextFile(file: File): boolean {
  if (TEXT_TYPES.includes(file.type)) return true;
  return TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1] ?? "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl: string): Promise<{ data: string; mediaType: string }> {
  const originalBase64 = dataUrlToBase64(dataUrl);
  if (originalBase64.length <= Math.ceil(MAX_IMAGE_UPLOAD_BYTES * 4 / 3)) {
    const mediaType = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
    return { data: originalBase64, mediaType };
  }

  const image = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { data: originalBase64, mediaType: "image/png" };
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", IMAGE_JPEG_QUALITY),
  );
  if (!blob) return { data: originalBase64, mediaType: "image/png" };
  const compressedDataUrl = await blobToDataUrl(blob);
  const compressedBase64 = dataUrlToBase64(compressedDataUrl);
  if (compressedBase64.length >= originalBase64.length) {
    const mediaType = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
    return { data: originalBase64, mediaType };
  }
  return { data: compressedBase64, mediaType: "image/jpeg" };
}

function processImageFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = reader.result as string;
        const processed = await compressImageDataUrl(data).catch(() => ({
          data: dataUrlToBase64(data),
          mediaType: file.type,
        }));
        resolve({
          id: crypto.randomUUID(), file,
          data: processed.data,
          mediaType: processed.mediaType, name: file.name,
          attachmentType: "image",
          preview: URL.createObjectURL(file),
        });
      } catch (err) {
        console.warn("[attach] processImageFile onload threw, dropping", { name: file.name, err });
        resolve(null);
      }
    };
    // Without an explicit onerror the Promise hangs forever on read failure
    // (e.g. when the clipboard hands us a synthetic File that the browser
    // can't actually fulfil). The hang fans out into `Promise.all` inside
    // `addFiles` and silently swallows every paste/drop/+ intake — exactly
    // the symptom we hit before this guard.
    reader.onerror = () => {
      console.warn("[attach] processImageFile FileReader error", { name: file.name, error: reader.error });
      resolve(null);
    };
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      console.warn("[attach] processImageFile readAsDataURL threw", { name: file.name, err });
      resolve(null);
    }
  });
}

function processTextFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = (reader.result as string) ?? "";
        const bytes = new TextEncoder().encode(text);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        resolve({
          id: crypto.randomUUID(), file,
          data: btoa(binary),
          mediaType: file.type || "text/plain", name: file.name,
          attachmentType: "text",
        });
      } catch (err) {
        console.warn("[attach] processTextFile onload threw, dropping", { name: file.name, err });
        resolve(null);
      }
    };
    reader.onerror = () => {
      console.warn("[attach] processTextFile FileReader error", { name: file.name, error: reader.error });
      resolve(null);
    };
    try {
      reader.readAsText(file);
    } catch (err) {
      console.warn("[attach] processTextFile readAsText threw", { name: file.name, err });
      resolve(null);
    }
  });
}

export function processFile(file: File): Promise<AttachmentItem | null> {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    console.warn("[attach] processFile rejected: size cap", {
      name: file.name,
      size: file.size,
      cap: MAX_FILE_SIZE_MB * 1024 * 1024,
    });
    return Promise.resolve(null);
  }
  if (IMAGE_TYPES.includes(file.type)) return processImageFile(file);
  if (isTextFile(file)) return processTextFile(file);
  console.warn("[attach] processFile rejected: unsupported type", {
    name: file.name,
    type: file.type,
  });
  return Promise.resolve(null);
}

/** Convert base64 string to Blob for S3 upload. */
function base64ToBlob(base64: string, mediaType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

/** Fire-and-forget S3 upload for a single attachment. */
async function uploadAttachmentToS3(
  item: AttachmentItem,
  onUpdate: (id: string, updates: Partial<AttachmentItem>) => void,
  signal: AbortSignal,
): Promise<void> {
  onUpdate(item.id, { uploading: true, uploadProgress: 0 });
  try {
    const blob = base64ToBlob(item.data, item.mediaType);
    const fileUrl = await uploadFile(
      blob,
      item.name,
      item.mediaType,
      (percent) => onUpdate(item.id, { uploadProgress: percent }),
      signal,
    );
    onUpdate(item.id, { fileUrl, uploading: false, uploadProgress: 100 });
  } catch (err) {
    if (signal.aborted) return;
    const message = err instanceof Error ? err.message : "Upload failed";
    console.warn("[upload] S3 upload failed, will fall back to base64:", message);
    onUpdate(item.id, { uploading: false, uploadError: message });
  }
}

export function useFileAttachments(
  attachments: AttachmentItem[],
  onAttachmentsChange?: (items: AttachmentItem[]) => void,
  onRemoveAttachment?: (id: string) => void,
  onUpdateAttachment?: (id: string, updates: Partial<AttachmentItem>) => void,
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>,
) {
  const attachmentsRef = useRef(attachments);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => () => { attachmentsRef.current.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); }, []);

  // Abort controllers for in-flight uploads, keyed by attachment id.
  const uploadAbortRefs = useRef<Map<string, AbortController>>(new Map());
  useEffect(() => () => {
    for (const controller of uploadAbortRefs.current.values()) controller.abort();
  }, []);

  const totalSizeMB = attachments.reduce((sum, a) => sum + a.file.size, 0) / (1024 * 1024);
  const canAddMore = attachments.length < MAX_ATTACHMENTS && totalSizeMB < MAX_TOTAL_SIZE_MB;

  const addFiles = useCallback(async (files: FileList | null) => {
    console.log("[attach] addFiles entry", {
      count: files?.length ?? 0,
      hasCallback: Boolean(onAttachmentsChange),
      canAddMore,
      currentLen: attachments.length,
    });
    if (!files?.length) {
      console.warn("[attach] addFiles short-circuit: no files");
      return;
    }
    if (!onAttachmentsChange) {
      console.warn("[attach] addFiles short-circuit: no onAttachmentsChange");
      return;
    }
    if (!canAddMore) {
      console.warn("[attach] addFiles short-circuit: canAddMore=false", {
        currentLen: attachments.length,
        max: MAX_ATTACHMENTS,
      });
      return;
    }
    const toAdd = Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length);
    console.log("[attach] addFiles processing", {
      toAddCount: toAdd.length,
      types: toAdd.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    });
    const results = await Promise.all(toAdd.map(processFile));
    const valid = results.filter((r): r is AttachmentItem => r !== null);
    console.log("[attach] addFiles processed", {
      processed: results.length,
      valid: valid.length,
      droppedNull: results.length - valid.length,
    });
    if (valid.length) {
      void import("../../../../lib/analytics").then(({ track }) =>
        track("file_attached", { file_count: valid.length }),
      );
      const next = [...attachments, ...valid];
      console.log("[attach] addFiles invoking onAttachmentsChange", {
        from: attachments.length,
        to: next.length,
      });
      onAttachmentsChange(next);

      // Kick off S3 uploads after the state update renders so the ref
      // has the new items before onUpdate reads it.
      if (onUpdateAttachment) {
        const itemsToUpload = [...valid];
        setTimeout(() => {
          for (const item of itemsToUpload) {
            const controller = new AbortController();
            uploadAbortRefs.current.set(item.id, controller);
            void uploadAttachmentToS3(item, onUpdateAttachment, controller.signal).finally(() => {
              uploadAbortRefs.current.delete(item.id);
            });
          }
        }, 0);
      }
    } else {
      console.warn("[attach] addFiles produced zero valid items, no preview will render");
    }
    textareaRef?.current?.focus();
  }, [attachments, canAddMore, onAttachmentsChange, onUpdateAttachment, textareaRef]);

  const handleRemove = useCallback((id: string) => {
    // Abort any in-flight upload for this attachment
    const controller = uploadAbortRefs.current.get(id);
    if (controller) {
      controller.abort();
      uploadAbortRefs.current.delete(id);
    }
    const a = attachments.find((x) => x.id === id);
    if (a?.preview) URL.revokeObjectURL(a.preview);
    onRemoveAttachment?.(id);
  }, [attachments, onRemoveAttachment]);

  return { canAddMore, addFiles, handleRemove };
}
