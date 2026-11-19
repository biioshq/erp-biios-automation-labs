import { NextResponse, type NextRequest } from "next/server";
import { Types } from "mongoose";
import { getCurrentUser } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { FileModel } from "@/server/models";
import { isHiddenFromUser } from "@/features/files/server";
import { UploadError, readStoredFile } from "@/server/storage";

/** Serves a stored file to signed-in users. ?download=1 forces a download. */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await connectDB();
  const doc = await FileModel.findById(id).lean();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Payslips and other salary receipts are admin-only, even for someone who knows the file id.
  if (await isHiddenFromUser(doc._id, user)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readStoredFile(doc.storageKey);
  } catch (error) {
    // Storage settings problems (for example wrong Cloudinary keys) say what to fix.
    if (error instanceof UploadError) {
      console.error("[files] storage problem: %s", error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[files] could not read %s", doc.storageKey, error);
    return NextResponse.json({ error: "The file is missing from storage." }, { status: 410 });
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  // SVGs can carry scripts: always download them rather than render inline.
  const inline = !download && doc.mimeType !== "image/svg+xml";
  const encoded = encodeURIComponent(doc.name);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // PDFs and images must stay viewable inline (Chrome's PDF viewer breaks under a sandbox CSP);
      // anything else is locked down.
      ...(doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/")
        ? {}
        : { "Content-Security-Policy": "default-src 'none'; sandbox" }),
    },
  });
}
