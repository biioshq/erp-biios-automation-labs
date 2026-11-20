"use client";

import type { FileDTO } from "./types";
import { prepareUpload, type PrepareOptions } from "./prepare";

export type UploadMeta = {
  kind: "receipt" | "document" | "attachment" | "photo";
  documentType?: string;
  projectId?: string;
  entityType?: "expense" | "income" | "task" | "project" | "movement";
  entityId?: string;
};

/**
 * What to tell people when the server answers without the app's own JSON error, for example
 * Vercel's error pages (they carry an x-vercel-error code) or a proxy in between.
 */
export function httpFailureMessage(status: number, vercelError: string | null, action = "Upload"): string {
  const code = vercelError ? `, ${vercelError}` : "";
  if (status === 0) return "Network error. Check your connection and try again.";
  if (status === 401) return "Your session has ended. Sign in again, then retry.";
  if (status === 403) return "You do not have permission to do this.";
  if (status === 413 || vercelError === "FUNCTION_PAYLOAD_TOO_LARGE") {
    return "The file is too large for the server (at most 4 MB per file here). Use a smaller file or a photo instead of a scan.";
  }
  if (status === 429) return "Too many uploads in a minute. Wait a moment and try again.";
  if (status === 504 || status === 408 || vercelError === "FUNCTION_INVOCATION_TIMEOUT") {
    return `The server took too long and stopped (error ${status}${code}). Try again in a moment.`;
  }
  if (status >= 500) {
    return `${action} failed on the server (error ${status}${code}). Try again; if it keeps failing, an admin can see the reason in the deployment's logs.`;
  }
  return `${action} failed (error ${status}${code}).`;
}

/** Uploads one file to /api/files with progress (0–1). Resolves with the stored file. */
export async function uploadFile(
  original: File,
  meta: UploadMeta,
  onProgress?: (ratio: number) => void,
  prepare?: PrepareOptions,
): Promise<FileDTO> {
  const file = await prepareUpload(original, prepare);
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    for (const [k, v] of Object.entries(meta)) if (v) form.append(k, v);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: { file?: FileDTO; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.file) resolve(body.file);
      else reject(new Error(body.error ?? httpFailureMessage(xhr.status, xhr.getResponseHeader("x-vercel-error"))));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading. Check your connection and try again."));
    xhr.send(form);
  });
}
