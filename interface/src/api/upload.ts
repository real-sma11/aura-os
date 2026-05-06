import { apiFetch } from "../shared/api/core";

export interface PresignResponse {
  upload_url: string;
  file_url: string;
  key: string;
  expires_in: number;
}

/**
 * Request a presigned S3 upload URL from the backend.
 */
export async function requestPresignedUrl(
  contentType: string,
  filename: string,
): Promise<PresignResponse> {
  return apiFetch<PresignResponse>("/api/upload/presign", {
    method: "POST",
    body: JSON.stringify({ content_type: contentType, filename }),
  });
}

/**
 * Upload a file directly to S3 using a presigned PUT URL.
 *
 * Uses XMLHttpRequest for upload progress tracking (fetch doesn't
 * support upload progress). No Authorization header — the presigned
 * URL contains query-string auth.
 *
 * Works in browser, Electron, and Capacitor.
 */
export function uploadToS3(
  uploadUrl: string,
  data: Blob | ArrayBuffer,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("S3 upload failed: network error"));
    xhr.ontimeout = () => reject(new Error("S3 upload failed: timeout"));
    xhr.onabort = () => reject(new Error("S3 upload aborted"));

    xhr.send(data);
  });
}

/**
 * End-to-end: presign + upload. Returns the permanent public file URL.
 *
 * Accepts a Blob (e.g. from canvas compression or File picker).
 * The caller should do any image compression BEFORE calling this.
 */
export async function uploadFile(
  file: Blob,
  filename: string,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const presigned = await requestPresignedUrl(contentType, filename);
  await uploadToS3(presigned.upload_url, file, contentType, onProgress, signal);
  return presigned.file_url;
}
