import { NextResponse, type NextRequest } from "next/server";
import { Types } from "mongoose";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { connectDB } from "@/server/db";
import { UploadError, readStoredFile } from "@/server/storage";
import { FileModel } from "@/server/models";
import { OCR_MIME_TYPES, type OcrResponse } from "@/lib/ocr";
import { isClaimableFile, isHiddenFromUser, storeFile, toFileDTO } from "@/features/files/server";

export const maxDuration = 60;

type FileDTO = ReturnType<typeof toFileDTO>;

/**
 * Reads a receipt and returns the extracted GST invoice fields with a confidence per field.
 *
 *   POST { fileId }             reads a receipt already stored through /api/files (what the app uses)
 *   POST multipart "file"       stores the receipt, then reads it (kept for older clients)
 *
 * Reading never loses the receipt: when it fails or takes too long, the answer is the stored
 * file with `ocr: null` and `error` saying why, and the person fills the form by hand.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  const limited = rateLimit(`receipts:${user.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many receipts in a minute. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  let file: FileDTO;
  let storageKey: string;
  let mimeType: string;
  try {
    await connectDB();
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { fileId?: unknown } | null;
      const fileId = typeof body?.fileId === "string" ? body.fileId : "";
      if (!Types.ObjectId.isValid(fileId)) return NextResponse.json({ error: "No receipt was given." }, { status: 400 });
      // Only a receipt the caller has just uploaded and not saved on a record yet, which is all the form reads.
      // Any other stored file (a payslip, another record's receipt) would hand out its figures to whoever has
      // the id, past the checks /api/files/[id] makes.
      const own = await isClaimableFile(fileId, null, { uploadedBy: user.id });
      const doc = own ? await FileModel.findById(fileId).populate("uploadedBy", "name").lean() : null;
      if (!doc || (await isHiddenFromUser(doc._id, user))) {
        return NextResponse.json({ error: "That receipt no longer exists." }, { status: 404 });
      }
      if (!(OCR_MIME_TYPES as readonly string[]).includes(doc.mimeType)) {
        return NextResponse.json({ error: "Only PNG, JPEG and WebP images and PDFs can be read." }, { status: 400 });
      }
      file = toFileDTO(doc);
      storageKey = doc.storageKey;
      mimeType = doc.mimeType;
    } else {
      const form = await request.formData().catch(() => null);
      const upload = form?.get("file");
      if (!(upload instanceof File)) return NextResponse.json({ error: "No file was sent." }, { status: 400 });
      if (!(OCR_MIME_TYPES as readonly string[]).includes(upload.type)) {
        return NextResponse.json({ error: "Upload a PNG, JPEG, WebP image or a PDF." }, { status: 400 });
      }
      const doc = await storeFile({ file: upload, kind: "receipt", userId: user.id });
      file = toFileDTO(doc);
      storageKey = doc.storageKey;
      mimeType = doc.mimeType;
    }
  } catch (error) {
    if (error instanceof UploadError) {
      if (error.status >= 500) console.error("[ocr] storage problem: %s", error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[ocr] upload failed", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  // From here on the receipt is stored: every outcome answers with it.
  try {
    const bytes = await readStoredFile(storageKey);
    // Loaded here, not at the top, so a reader that cannot start never breaks storing receipts.
    const { extractInvoice } = await import("@/server/ocr/extract").catch((error: unknown) => {
      throw Object.assign(new Error("The receipt reader could not start on this server.", { cause: error }), { name: "OcrUnavailableError" });
    });
    const ocr = await extractInvoice(bytes, mimeType);
    return NextResponse.json({
      file,
      ocr: { fields: ocr.fields, overallConfidence: ocr.overallConfidence, source: ocr.source, durationMs: ocr.durationMs },
    } satisfies OcrResponse);
  } catch (error) {
    console.error("[ocr] reading failed", error);
    const name = error instanceof Error ? error.name : "";
    const reason =
      error instanceof UploadError || name === "OcrTimeoutError"
        ? (error as Error).message
        : name === "OcrUnavailableError"
          ? "The receipt reader could not start on this server. An admin can open /api/health?check=ocr to see why."
          : "The receipt reader could not make sense of this file.";
    return NextResponse.json({ file, ocr: null, error: reason } satisfies OcrResponse);
  }
}
