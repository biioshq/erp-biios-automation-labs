import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { connectDB } from "@/server/db";
import { UploadError, readStoredFile } from "@/server/storage";
import { extractInvoice, OCR_MIME_TYPES } from "@/server/ocr/extract";
import { storeFile, toFileDTO } from "@/features/files/server";

export const maxDuration = 60;

/**
 * Stores a receipt (image or PDF) and reads it: returns the stored file plus
 * the extracted GST invoice fields with a confidence per field.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimit(`receipts:${user.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many receipts in a minute. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  if (!(OCR_MIME_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: "Upload a PNG, JPEG, WebP image or a PDF." }, { status: 400 });
  }

  try {
    await connectDB();
    const doc = await storeFile({ file, kind: "receipt", userId: user.id });
    const fileDTO = toFileDTO(doc);
    try {
      const bytes = await readStoredFile(doc.storageKey);
      const ocr = await extractInvoice(bytes, doc.mimeType);
      return NextResponse.json({
        file: fileDTO,
        ocr: { fields: ocr.fields, overallConfidence: ocr.overallConfidence, source: ocr.source, durationMs: ocr.durationMs },
      });
    } catch (error) {
      console.error("[ocr] extraction failed", error);
      // The receipt is still stored; the user fills the form by hand.
      return NextResponse.json({ file: fileDTO, ocr: null, error: "We stored the receipt but could not read it." });
    }
  } catch (error) {
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[ocr] upload failed", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
