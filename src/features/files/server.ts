import "server-only";

import { Types } from "mongoose";
import { FileModel, type FileDoc, type FileKind } from "@/server/models";
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

/** Links already-uploaded files to the record they belong to. */
export async function attachFiles(fileIds: string[], entity: { type: "expense" | "income" | "task" | "project" | "movement"; id: string }, projectId?: string | null) {
  const ids = fileIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (!ids.length) return;
  await FileModel.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        entity: { type: entity.type, id: new Types.ObjectId(entity.id) },
        ...(projectId ? { project: new Types.ObjectId(projectId) } : {}),
      },
    },
  );
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
