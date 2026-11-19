"use client";

import type { FileDTO } from "./types";
import { prepareUpload } from "./prepare";

export type UploadMeta = {
  kind: "receipt" | "document" | "attachment";
  documentType?: string;
  projectId?: string;
  entityType?: "expense" | "income" | "task" | "project" | "movement";
  entityId?: string;
};

/** Uploads one file to /api/files with progress (0–1). Resolves with the stored file. */
export async function uploadFile(original: File, meta: UploadMeta, onProgress?: (ratio: number) => void): Promise<FileDTO> {
  const file = await prepareUpload(original);
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
      else reject(new Error(body.error ?? "Upload failed. Please try again."));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading."));
    xhr.send(form);
  });
}
