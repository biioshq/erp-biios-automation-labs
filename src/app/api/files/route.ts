import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { can, getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { connectDB } from "@/server/db";
import { UploadError } from "@/server/storage";
import { FILE_KINDS } from "@/server/models";
import { FILE_ATTACH_PERMISSIONS, UPLOAD_ENTITY_TYPES, storeFile, toFileDTO } from "@/features/files/server";
import { bumpChanges } from "@/server/changes";
import { PROJECT_DOCUMENT_TYPES, valuesOf } from "@/lib/constants";

const metaSchema = z.object({
  kind: z.enum(FILE_KINDS),
  documentType: z.enum(valuesOf(PROJECT_DOCUMENT_TYPES)).optional(),
  projectId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  entityType: z.enum(UPLOAD_ENTITY_TYPES).optional(),
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
  // A file named for a record is attached to it at once, so it needs the right to add or change that
  // kind of record. Uploads for a form that is not saved yet stay open to everyone signed in.
  if (meta.data.entityType && meta.data.entityId && !FILE_ATTACH_PERMISSIONS[meta.data.entityType].some((p) => can(user, p))) {
    return NextResponse.json({ error: "You do not have permission to do this." }, { status: 403 });
  }

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
    // A document added to a project shows up on other people's open project pages.
    if (meta.data.projectId || meta.data.entityId) await bumpChanges();
    return NextResponse.json({ file: toFileDTO(doc) }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) {
      if (error.status >= 500) console.error("[upload] storage problem: %s", error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[upload] failed", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
