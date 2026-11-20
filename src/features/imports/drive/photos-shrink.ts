import "server-only";

import { PHOTO_MAX_EDGE } from "@/features/files/types";

/** Same rules as the item page's upload (prepareUpload): small photos are kept as they are. */
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const QUALITY = 86;
const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ShrunkPhoto = { bytes: Buffer; mimeType: string; name: string };

/**
 * Scales a JPEG, PNG or WebP photo to at most PHOTO_MAX_EDGE on the long side and saves it as JPEG,
 * so list thumbnails do not download a 4 MB original. EXIF orientation is applied while decoding.
 * Returns the original bytes when the photo is already small, cannot be decoded or would not get smaller.
 */
export async function shrinkPhoto(input: ShrunkPhoto): Promise<ShrunkPhoto> {
  if (!RESIZABLE.has(input.mimeType)) return input; // GIFs may be animated
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(input.bytes);
    const longEdge = Math.max(image.width, image.height);
    if (!longEdge) return input;
    if (input.bytes.byteLength <= SHRINK_ABOVE_BYTES && longEdge <= PHOTO_MAX_EDGE) return input;

    const scale = Math.min(1, PHOTO_MAX_EDGE / longEdge);
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const ctx = canvas.getContext("2d");
    // White under transparent PNGs, as on the item page.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const bytes = Buffer.from(await canvas.encode("jpeg", QUALITY));
    if (bytes.byteLength >= input.bytes.byteLength) return input;
    return { bytes, mimeType: "image/jpeg", name: input.name.replace(/\.(png|jpe?g|webp)$/i, "") + ".jpg" };
  } catch (error) {
    console.warn("[drive-photos] could not shrink %s, keeping the original", input.name, error instanceof Error ? error.message : error);
    return input;
  }
}
