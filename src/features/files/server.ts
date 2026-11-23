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

/** What a stored file can belong to. */
export type FileEntityType =
  | "expense"
  | "income"
  | "task"
  | "project"
  | "movement"
  | "item"
  | "invoice"
  | "fixed_asset"
  | "liability"
  | "capital"
  | "investment"
  | "bank_statement";

/** Records whose papers only admins see (capital, loans, investments, bank statements), like salary receipts. */
const ADMIN_ONLY_ENTITIES: FileEntityType[] = ["liability", "capital", "investment", "bank_statement"];

type StoreOptions = {
  kind: FileKind;
  userId: string;
  documentType?: ProjectDocumentType;
  projectId?: string;
  entity?: { type: FileEntityType; id: string };
  /** Set for files imported from Google Drive. */
  driveFileId?: string;
};

export async function storeFile(input: StoreOptions & { file: File }): Promise<FileDoc> {
  const { file, ...options } = input;
  return storeBuffer({ ...options, bytes: Buffer.from(await file.arrayBuffer()), name: file.name, mimeType: file.type });
}

/** Stores bytes the server already holds (for example a file downloaded from Google Drive). */
export async function storeBuffer(input: StoreOptions & { bytes: Buffer; name: string; mimeType: string }): Promise<FileDoc> {
  const stored = await saveUpload(input.bytes, input.mimeType);
  try {
    return await FileModel.create({
      name: safeDisplayName(input.name),
      mimeType: stored.mimeType,
      size: stored.size,
      storageKey: stored.storageKey,
      checksum: stored.checksum,
      kind: input.kind,
      documentType: input.documentType,
      project: input.projectId && Types.ObjectId.isValid(input.projectId) ? new Types.ObjectId(input.projectId) : undefined,
      entity: input.entity ? { type: input.entity.type, id: new Types.ObjectId(input.entity.id) } : undefined,
      uploadedBy: new Types.ObjectId(input.userId),
      ...(input.driveFileId ? { driveFileId: input.driveFileId } : {}),
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
export async function attachFiles(fileIds: string[], entity: { type: FileEntityType; id: string }, projectId?: string | null) {
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
export async function isHiddenFromUser(fileId: Types.ObjectId | string, user: { role: string }, kind?: string): Promise<boolean> {
  if (user.role === "admin") return false;
  // Item photos can never be receipts (expenses only take files of kind "receipt"), so a list of
  // thumbnails costs no extra query. Callers that hold the file record pass its kind.
  if (kind === "photo") return false;
  const id = new Types.ObjectId(String(fileId));
  const [salary, adminOnly] = await Promise.all([
    Expense.exists({ receipt: id, category: "salaries" }),
    FileModel.exists({ _id: id, "entity.type": { $in: ADMIN_ONLY_ENTITIES } }),
  ]);
  return Boolean(salary || adminOnly);
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
