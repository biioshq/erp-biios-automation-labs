import "server-only";

import { Types } from "mongoose";
import {
  CapitalEntry,
  Expense,
  ExpenseDraft,
  FileModel,
  Income,
  InventoryItem,
  InventoryMovement,
  Invoice,
  Task,
  type FileDoc,
  type FileKind,
} from "@/server/models";
import { can, type SessionUser } from "@/server/auth/session";
import { INVENTORY_RESOURCES } from "@/lib/permissions/inventory";
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

/** Every inventory page shows item photos, so seeing any of them is enough for a photo. */
const INVENTORY_VIEWS = INVENTORY_RESOURCES.filter((r) => r.actions.includes("view")).map((r) => `${r.key}:view`);

/** Purchase receipts belong to the stock movement; the purchase expense points at the same file. */
const MOVEMENT_VIEWS = ["inventory.movements:view", "inventory.purchase:view", "finance.expenses:view"];

/**
 * Who may open a file attached to a record: anyone who may view that record (any one of the
 * permissions is enough). Before roles, members saw every file except those on liabilities,
 * capital, investments and bank statements; the Member defaults give the same result.
 */
export const FILE_VIEW_PERMISSIONS: Record<FileEntityType, string[]> = {
  expense: ["finance.expenses:view"],
  income: ["finance.income:view"],
  invoice: ["finance.invoices:view"],
  project: ["finance.projects:view"],
  task: ["tasks.tasks:view"],
  item: INVENTORY_VIEWS,
  movement: MOVEMENT_VIEWS,
  fixed_asset: ["finance.fixed_assets:view"],
  liability: ["finance.liabilities:view"],
  capital: ["finance.equity:view"],
  investment: ["finance.investments:view"],
  bank_statement: ["finance.bank_statements:view"],
};

/**
 * Who may attach a new upload straight to a record (POST /api/files with entityType and entityId):
 * anyone who may add or change that kind of record.
 */
export const FILE_ATTACH_PERMISSIONS: Record<UploadEntityType, string[]> = {
  expense: ["finance.expenses:create", "finance.expenses:edit"],
  income: ["finance.income:create", "finance.income:edit"],
  task: ["tasks.tasks:create", "tasks.tasks:edit"],
  project: ["finance.projects:create", "finance.projects:edit"],
  movement: ["inventory.purchase:create"],
};

/** The record kinds an upload may name. */
export type UploadEntityType = "expense" | "income" | "task" | "project" | "movement";
export const UPLOAD_ENTITY_TYPES = ["expense", "income", "task", "project", "movement"] as const satisfies readonly UploadEntityType[];

const canAny = (user: SessionUser, permissions: readonly string[]) => permissions.some((p) => can(user, p));

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

type FileRef = { _id: Types.ObjectId; kind?: string | null; entity?: { type?: string | null; id?: Types.ObjectId | null } | null };

/**
 * The view permissions of the records that use a file not linked to a record (older files and
 * fresh uploads). Null when no record uses it.
 */
async function referencedBy(id: Types.ObjectId): Promise<string[] | null> {
  const [expense, income, invoice, capital, movement, task, item, draft] = await Promise.all([
    Expense.exists({ receipt: id }),
    Income.exists({ receipt: id }),
    Invoice.exists({ file: id }),
    CapitalEntry.exists({ documents: id }),
    InventoryMovement.exists({ receipt: id }),
    Task.exists({ attachments: id }),
    InventoryItem.exists({ photoFileId: id }),
    ExpenseDraft.exists({ file: id }),
  ]);
  const found = [
    expense ? FILE_VIEW_PERMISSIONS.expense : [],
    income ? FILE_VIEW_PERMISSIONS.income : [],
    invoice ? FILE_VIEW_PERMISSIONS.invoice : [],
    capital ? FILE_VIEW_PERMISSIONS.capital : [],
    movement ? FILE_VIEW_PERMISSIONS.movement : [],
    task ? FILE_VIEW_PERMISSIONS.task : [],
    item ? FILE_VIEW_PERMISSIONS.item : [],
    draft ? ["finance.import:view"] : [],
  ].flat();
  return found.length ? found : null;
}

/**
 * True when the person may not open this file. A file on a record needs the view permission of
 * that record (FILE_VIEW_PERMISSIONS). Payslips and other salary receipts also need
 * "data.salaries", even for someone who knows the file id. A file no record uses yet (a fresh
 * upload) stays open to signed-in people, as before, so the uploader can preview it.
 */
export async function isFileHidden(doc: FileRef, user: SessionUser): Promise<boolean> {
  const type = doc.entity?.id ? (doc.entity.type as FileEntityType | undefined) : undefined;
  const allowed = type && type in FILE_VIEW_PERMISSIONS ? FILE_VIEW_PERMISSIONS[type] : await referencedBy(doc._id);
  if (allowed && !canAny(user, allowed)) return true;
  // Item photos can never be receipts (expenses only take files of kind "receipt"), so a list of
  // thumbnails costs no extra query.
  if (doc.kind === "photo" || can(user, "data.salaries")) return false;
  return Boolean(await Expense.exists({ receipt: doc._id, category: "salaries" }));
}

/**
 * Every route that hands out a stored file or what is read from it (download, OCR) asks this first.
 * Missing files count as hidden.
 */
export async function isHiddenFromUser(fileId: Types.ObjectId | string, user: SessionUser, kind?: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(String(fileId))) return true;
  const doc = await FileModel.findById(String(fileId), { kind: 1, entity: 1 }).lean();
  if (!doc) return true;
  return isFileHidden({ _id: doc._id, kind: kind ?? doc.kind, entity: doc.entity }, user);
}

/** Drops the files this person may not open, for lists of files on a page. */
export async function visibleFiles<T extends { id: string }>(files: T[], user: SessionUser): Promise<T[]> {
  if (!files.length) return files;
  const hidden = await Promise.all(files.map((f) => isHiddenFromUser(f.id, user)));
  return files.filter((_, i) => !hidden[i]);
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
