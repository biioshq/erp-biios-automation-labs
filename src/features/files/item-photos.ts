import "server-only";

import { Types } from "mongoose";
import { AppError, notFound } from "@/server/errors";
import { FileModel, InventoryItem } from "@/server/models";
import { removeFile } from "./server";

/** Images a browser shows inline. SVG is left out: the file route always downloads it, and it can carry scripts. */
export const PHOTO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type PhotoOutcome = { status: "saved"; replaced: boolean } | { status: "skipped"; reason: string };

const oid = (id: string) => new Types.ObjectId(id);

/** A free photo upload (nobody's file yet), optionally by one uploader. */
function freePhoto(fileId: string, uploadedBy?: string) {
  return {
    _id: oid(fileId),
    kind: "photo" as const,
    ...(uploadedBy ? { uploadedBy: oid(uploadedBy) } : {}),
    $or: [{ "entity.id": { $exists: false } }, { "entity.id": null }],
  };
}

/** Deletes a stored file if it belongs to this item and no other item shows it. Never fails the caller. */
async function removeOldPhoto(fileId: Types.ObjectId | string, itemId: string) {
  try {
    const id = String(fileId);
    const file = await FileModel.findById(id).select("entity kind").lean();
    if (!file) return;
    const ownedHere = file.entity?.type === "item" && String(file.entity.id) === itemId;
    const unowned = !file.entity?.id && file.kind === "photo";
    if (!ownedHere && !unowned) return;
    if (await InventoryItem.exists({ photoFileId: oid(id) })) return;
    await removeFile(id);
  } catch (error) {
    console.error("[item-photos] could not delete the old photo %s", String(fileId), error);
  }
}

/**
 * Makes a stored, still unowned photo file the item's photo.
 *
 * The file is claimed first (so no other record can take it), then the item is updated. Without
 * `replace`, the item must have no photo at that moment; with it, the old photo file is deleted only
 * after the new one is saved on the item. When nothing is saved, the new file is deleted again.
 */
export async function assignItemPhoto(input: { itemId: string; fileId: string; replace: boolean; uploadedBy?: string }): Promise<PhotoOutcome> {
  const { itemId, fileId, replace } = input;
  if (!Types.ObjectId.isValid(itemId) || !Types.ObjectId.isValid(fileId)) throw new AppError("Invalid photo or item.");

  const file = await FileModel.findOne(freePhoto(fileId, input.uploadedBy)).select("mimeType").lean();
  if (!file) throw new AppError("That photo upload was not found. Upload it again.", "not_found");
  if (!PHOTO_MIME_TYPES.has(file.mimeType)) {
    await removeFile(fileId);
    throw new AppError("Use a PNG, JPEG, WebP or GIF image for the photo.");
  }

  const item = await InventoryItem.findOne({ _id: oid(itemId), archivedAt: null }).select("_id").lean();
  if (!item) {
    await removeFile(fileId);
    throw notFound("The inventory item");
  }

  const claimed = await FileModel.updateOne(freePhoto(fileId, input.uploadedBy), {
    $set: { entity: { type: "item", id: oid(itemId) } },
    $unset: { project: 1 },
  });
  if (claimed.matchedCount === 0) throw new AppError("That photo upload was already used. Upload it again.", "conflict");

  if (!replace) {
    // Matches items without the field too (items from before photos existed).
    const set = await InventoryItem.updateOne({ _id: oid(itemId), archivedAt: null, photoFileId: null }, { $set: { photoFileId: oid(fileId) } });
    if (set.matchedCount === 0) {
      await removeFile(fileId);
      const stillThere = await InventoryItem.exists({ _id: oid(itemId), archivedAt: null });
      if (!stillThere) throw notFound("The inventory item");
      return { status: "skipped", reason: "The item already has a photo." };
    }
    return { status: "saved", replaced: false };
  }

  const before = await InventoryItem.findOneAndUpdate(
    { _id: oid(itemId), archivedAt: null },
    { $set: { photoFileId: oid(fileId) } },
    { returnDocument: "before" },
  )
    .select("photoFileId")
    .lean();
  if (!before) {
    await removeFile(fileId);
    throw notFound("The inventory item");
  }
  const old = before.photoFileId ? String(before.photoFileId) : null;
  if (old && old !== fileId) await removeOldPhoto(old, itemId);
  return { status: "saved", replaced: Boolean(old && old !== fileId) };
}

/**
 * Takes the photo off the item and deletes its file. `expectedFileId` (the photo the person saw)
 * guards against removing a photo someone else put there a moment ago.
 */
export async function removeItemPhoto(input: { itemId: string; expectedFileId?: string | null }): Promise<{ removed: boolean }> {
  const { itemId } = input;
  if (!Types.ObjectId.isValid(itemId)) throw new AppError("Invalid item.");
  const item = await InventoryItem.findOne({ _id: oid(itemId), archivedAt: null }).select("photoFileId").lean();
  if (!item) throw notFound("The inventory item");
  if (!item.photoFileId) return { removed: false };
  const current = String(item.photoFileId);
  if (input.expectedFileId && input.expectedFileId !== current) {
    throw new AppError("The photo changed a moment ago. Reload the page and try again.", "conflict");
  }
  const cleared = await InventoryItem.updateOne({ _id: item._id, photoFileId: item.photoFileId }, { $set: { photoFileId: null } });
  if (cleared.matchedCount === 0) throw new AppError("The photo changed a moment ago. Reload the page and try again.", "conflict");
  await removeOldPhoto(current, itemId);
  return { removed: true };
}

/** Deletes the uploader's own photo uploads that were never saved on an item (a failed or cancelled save). */
export async function discardPhotoUploads(fileIds: string[], uploadedBy: string) {
  const ids = fileIds.filter((id) => Types.ObjectId.isValid(id));
  for (const id of ids) {
    const free = await FileModel.exists(freePhoto(id, uploadedBy));
    if (free) await removeFile(id);
  }
}
