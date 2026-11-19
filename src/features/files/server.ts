import "server-only";

import { Types } from "mongoose";
import { Expense, FileModel, type FileDoc, type FileKind } from "@/server/models";
import { deleteStoredFile, saveUpload } from "@/server/storage";
import { iso } from "@/server/serialize";
import type { ProjectDocumentType } from "@/lib/constants";
import type { FileDTO } from "./types";

export function toFileDTO(doc: FileDoc & { uploadedBy?: unknown }): FileDTO {
  const id = String(doc._id);
  const uploader = doc.uploadedBy as { _id?: Types.ObjectId; name?: string } | undefined;
  return {
    id,
    name: doc.name,
    mimeType: doc.mimeType,
    size: doc.size,
    kind: doc.kind as FileDTO["kind"],
    documentType: (doc.documentType as ProjectDocumentType | undefined) ?? null,
    url: `/api/files/${id}`,
    downloadUrl: `/api/files/${id}?download=1`,
    createdAt: iso(doc.createdAt as Date) ?? new Date().toISOString(),
    uploadedBy: uploader?._id ? { id: String(uploader._id), name: uploader.name ?? "" } : null,
  };
}

/** Display name from an uploaded filename: no path, no control characters. */
export function safeDisplayName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "file";
}

export async function storeFile(input: {
  file: File;
  kind: FileKind;
  userId: string;
  documentType?: ProjectDocumentType;
  projectId?: string;
  entity?: { type: "expense" | "income" | "task" | "project" | "movement"; id: string };
}): Promise<FileDoc> {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const stored = await saveUpload(buffer, input.file.type);
  try {
    return await FileModel.create({
      name: safeDisplayName(input.file.name),
      mimeType: stored.mimeType,
      size: stored.size,
      storageKey: stored.storageKey,
      checksum: stored.checksum,
      kind: input.kind,
      documentType: input.documentType,
      project: input.projectId && Types.ObjectId.isValid(input.projectId) ? new Types.ObjectId(input.projectId) : undefined,
      entity: input.entity ? { type: input.entity.type, id: new Types.ObjectId(input.entity.id) } : undefined,
      uploadedBy: new Types.ObjectId(input.userId),
    });
  } catch (error) {
    await deleteStoredFile(stored.storageKey);
    throw error;
  }
}

/** Files nobody owns yet (fresh uploads) or already on this record: the only ones a record may take over. */
function claimableBy(entityId: string | null, uploadedBy?: string) {
  const by = uploadedBy ? { uploadedBy: new Types.ObjectId(uploadedBy) } : {};
  const free = [
    { "entity.id": { $exists: false }, ...by },
    { "entity.id": null, ...by },
  ];
  return { $or: entityId ? [...free, { "entity.id": new Types.ObjectId(entityId) }] : free };
}

/**
 * True when the file exists, is of the given kind and is free for this record to take: an unsaved upload
 * (by `uploadedBy` when given) or a file already on this record. Actions check this before saving a file id
 * on a record, so a crafted id cannot point at another record's file.
 */
export async function isClaimableFile(
  fileId: string,
  entityId: string | null,
  options: { kind?: FileKind; uploadedBy?: string } = {},
): Promise<boolean> {
  if (!Types.ObjectId.isValid(fileId)) return false;
  const found = await FileModel.exists({
    _id: new Types.ObjectId(fileId),
    ...(options.kind ? { kind: options.kind } : {}),
    ...claimableBy(entityId, options.uploadedBy),
  });
  return Boolean(found);
}

/**
 * Links already-uploaded files to the record they belong to. Files owned by another record are left alone.
 * The file's project follows the record's: without a project it is cleared, so deleting a project the record
 * has moved away from never deletes the record's files.
 */
export async function attachFiles(fileIds: string[], entity: { type: "expense" | "income" | "task" | "project" | "movement"; id: string }, projectId?: string | null) {
  const ids = fileIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (!ids.length) return;
  await FileModel.updateMany(
    { _id: { $in: ids }, ...claimableBy(entity.id) },
    projectId
      ? { $set: { entity: { type: entity.type, id: new Types.ObjectId(entity.id) }, project: new Types.ObjectId(projectId) } }
      : { $set: { entity: { type: entity.type, id: new Types.ObjectId(entity.id) } }, $unset: { project: 1 } },
  );
}

/**
 * Payslips and other salary receipts are admin-only, even for someone who knows the file id. Every route that
 * hands out a stored file or what is read from it (download, OCR) asks this first.
 */
export async function isHiddenFromUser(fileId: Types.ObjectId | string, user: { role: string }): Promise<boolean> {
  if (user.role === "admin") return false;
  return Boolean(await Expense.exists({ receipt: new Types.ObjectId(String(fileId)), category: "salaries" }));
}

/** Deletes the record and its bytes. */
export async function removeFile(fileId: string) {
  if (!Types.ObjectId.isValid(fileId)) return;
  const doc = await FileModel.findByIdAndDelete(fileId).lean();
  if (doc) await deleteStoredFile(doc.storageKey);
}

export async function getFiles(ids: (Types.ObjectId | string | null | undefined)[]): Promise<FileDTO[]> {
  const valid = ids.filter(Boolean).map((id) => new Types.ObjectId(String(id)));
  if (!valid.length) return [];
  const docs = await FileModel.find({ _id: { $in: valid } }).lean();
  return docs.map(toFileDTO);
}
