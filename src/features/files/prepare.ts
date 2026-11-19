"use client";

/**
 * Client-side preparation of uploads.
 *
 * Phone photos of receipts are often 3 to 8 MB. Before upload, large PNG/JPEG/WebP
 * images are scaled to at most 2400px on the long side and saved as JPEG (about
 * 0.5 to 1.5 MB), which uploads faster on mobile data, stays under Vercel's 4.5 MB
 * request limit and still reads well for OCR. PDFs and other files are left as they are.
 */

const MAX_EDGE = 2400;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const QUALITY = 0.86;

/** The server's per-file limit: 4 MB on Vercel, 15 MB elsewhere. */
export const MAX_UPLOAD_BYTES = (process.env.NEXT_PUBLIC_VERCEL_ENV ? 4 : 15) * 1024 * 1024;
export const MAX_UPLOAD_LABEL = `${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;

const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Returns a smaller JPEG for large images, or the original file. Never throws. */
export async function prepareUpload(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type) || typeof window === "undefined") return file;
  try {
    const bitmap = await loadBitmap(file);
    const width = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
    const height = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
    const longEdge = Math.max(width, height);
    if (file.size <= SHRINK_ABOVE_BYTES && longEdge <= MAX_EDGE) return file;

    const scale = Math.min(1, MAX_EDGE / longEdge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // White under transparent PNGs, so text stays readable as JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if ("close" in bitmap) bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
