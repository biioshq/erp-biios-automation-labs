import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { connectDB } from "@/server/db";
import { UploadError } from "@/server/storage";
import { FILE_KINDS } from "@/server/models";
import { storeFile, toFileDTO } from "@/features/files/server";
import { PROJECT_DOCUMENT_TYPES, valuesOf } from "@/lib/constants";

const metaSchema = z.object({
  kind: z.enum(FILE_KINDS),
  documentType: z.enum(valuesOf(PROJECT_DOCUMENT_TYPES)).optional(),
  projectId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  entityType: z.enum(["expense", "income", "task", "project", "movement"]).optional(),
  entityId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

/** Upload one file (multipart/form-data: file, kind, documentType?, projectId?, entityType?, entityId?). */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimit(`uploads:${user.id}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many uploads in a minute. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ error: "No file was sent." }, { status: 400 });

  const meta = metaSchema.safeParse({
    kind: form.get("kind") ?? "attachment",
    documentType: form.get("documentType") || undefined,
    projectId: form.get("projectId") || undefined,
    entityType: form.get("entityType") || undefined,
    entityId: form.get("entityId") || undefined,
  });
  if (!meta.success) return NextResponse.json({ error: "Invalid upload details." }, { status: 400 });

  try {
    await connectDB();
    const doc = await storeFile({
      file,
      kind: meta.data.kind,
      userId: user.id,
      documentType: meta.data.documentType,
      projectId: meta.data.projectId,
      entity: meta.data.entityType && meta.data.entityId ? { type: meta.data.entityType, id: meta.data.entityId } : undefined,
    });
    return NextResponse.json({ file: toFileDTO(doc) }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[upload] failed", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
