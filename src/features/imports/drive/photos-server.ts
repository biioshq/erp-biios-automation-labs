import "server-only";

import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "@/server/errors";
import { FileModel, InventoryItem } from "@/server/models";
import { DriveImport, driveImportKey } from "@/server/models/file";
import { DriveError, downloadDriveFile, driveConfigured, isImage, listDriveFiles } from "@/server/google-drive";
import { MAX_UPLOAD_BYTES, UploadError } from "@/server/storage";
import { removeFile, storeBuffer } from "@/features/files/server";
import { PHOTO_MIME_TYPES, assignItemPhoto } from "@/features/files/item-photos";
import { photoMatcher } from "./photos-match";
import { shrinkPhoto } from "./photos-shrink";
import type { DrivePhotoOutcome, DrivePhotoPlan, DrivePhotoRow } from "./photos-types";

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** Drive and storage problems carry messages meant for people; actions only show AppError messages. */
function asAppError(error: unknown): never {
  if (error instanceof DriveError || error instanceof UploadError) throw new AppError(error.message);
  throw error;
}

function assertConfigured() {
  if (!driveConfigured()) {
    throw new AppError(
      "Google Drive import is not set up. An admin needs to add GOOGLE_DRIVE_API_KEY in Vercel (a Google Cloud API key with the Google Drive API enabled), then redeploy.",
    );
  }
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

function problemOf(mimeType: string, size: number | null): string | null {
  if (!PHOTO_MIME_TYPES.has(mimeType)) {
    return /heic|heif/i.test(mimeType)
      ? "HEIC photos are not supported. Save it as JPEG and add it again."
      : "Only PNG, JPEG, WebP and GIF images can be item photos.";
  }
  if (size !== null && size > MAX_UPLOAD_BYTES) return `Larger than ${mb(MAX_UPLOAD_BYTES)}. Make it smaller, or add it on the item page, which shrinks photos.`;
  return null;
}

/** Lists the images in a shared folder and matches each to an active item, for review. Writes nothing. */
export async function planDrivePhotos(link: string): Promise<DrivePhotoPlan> {
  assertConfigured();
  const files = await listDriveFiles(link, isImage).catch(asAppError);
  const items = await InventoryItem.find({ archivedAt: null }).select("name sku photoFileId").sort({ name: 1 }).lean();
  const match = photoMatcher(items.map((i) => ({ id: String(i._id), name: i.name, sku: i.sku })));
  const names = new Map(items.map((i) => [String(i._id), i.name]));

  // Earlier imports of the same Drive files (works before the driveFileId indexes exist). The import
  // log is kept when a photo is later changed or removed; the File records cover imports made before it.
  const ids = files.map((f) => f.id);
  const [logged, stored] = ids.length
    ? await Promise.all([
        DriveImport.find({ _id: { $in: ids.map(keyOf) }, status: "done" }).select("driveFileId item").lean(),
        FileModel.find({ kind: "photo", driveFileId: { $in: ids }, "entity.type": "item", "entity.id": { $ne: null } }).select("driveFileId entity").lean(),
      ])
    : [[], []];
  const importedBy = new Map<string, string | null>();
  for (const f of stored) importedBy.set(f.driveFileId as string, f.entity?.type === "item" && f.entity.id ? String(f.entity.id) : null);
  for (const r of logged) if (!importedBy.get(r.driveFileId)) importedBy.set(r.driveFileId, r.item ? String(r.item) : null);

  const rows: DrivePhotoRow[] = files.map((f) => {
    const m = match(f.name);
    const importedItem = importedBy.has(f.id) ? (importedBy.get(f.id) ?? null) : undefined;
    return {
      driveFileId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size,
      matchedItemId: m.itemId,
      matchedBy: m.by,
      unmatchedReason: m.reason,
      problem: problemOf(f.mimeType, f.size),
      importedTo: importedItem === undefined ? null : { itemId: importedItem, itemName: importedItem ? (names.get(importedItem) ?? null) : null },
    };
  });

  return {
    rows,
    items: items.map((i) => ({
      id: String(i._id),
      name: i.name,
      sku: i.sku,
      hasPhoto: Boolean(i.photoFileId),
      photoUrl: i.photoFileId ? `/api/files/${String(i.photoFileId)}` : null,
    })),
    maxBytes: MAX_UPLOAD_BYTES,
  };
}

/** The image type from the first bytes; the Drive listing's type is not trusted. */
export function sniffImageType(bytes: Buffer): string | null {
  const head = bytes.subarray(0, 12);
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  return null;
}

const keyOf = (driveFileId: string) => driveImportKey("item_photo", driveFileId);
const IMPORTED_BEFORE = "This Drive file was imported before.";
const BUSY = "This Drive file is being added from another tab or by another admin right now.";
/** A claim this old belongs to an import that was cut off (for example by a time limit). */
const STALE_CLAIM_MS = 5 * 60 * 1000;

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/**
 * Claims a Drive file for this import, atomically through the claim's `_id`. Returns the claim token,
 * or why the file is skipped: imported before, or being imported by another request right now.
 */
async function claimDriveFile(driveFileId: string, userId: string): Promise<{ token: string } | { skip: string }> {
  const _id = keyOf(driveFileId);
  const token = randomUUID();
  const now = new Date();
  const claim = { claimToken: token, claimedAt: now, importedBy: new Types.ObjectId(userId) };
  try {
    await DriveImport.create({ _id, driveFileId, kind: "item_photo", status: "pending", ...claim });
    return { token };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  const taken = await DriveImport.findOneAndUpdate(
    { _id, status: "pending", claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    { $set: claim },
  ).lean();
  if (taken) return { token };
  const existing = await DriveImport.findById(_id).select("status").lean();
  return { skip: existing?.status === "done" ? IMPORTED_BEFORE : BUSY };
}

/** Gives up this import's claim, so the file can be imported later. Never fails the caller. */
async function releaseClaim(driveFileId: string, token: string) {
  await DriveImport.deleteOne({ _id: keyOf(driveFileId), status: "pending", claimToken: token }).catch((error) =>
    console.error("[drive-photos] could not release the claim on %s", driveFileId, error),
  );
}

/** Marks the claim done: from now on this Drive file counts as imported, whatever happens to the photo. */
async function finishClaim(driveFileId: string, token: string, done: { item?: Types.ObjectId; file?: Types.ObjectId }) {
  await DriveImport.updateOne(
    { _id: keyOf(driveFileId), claimToken: token },
    { $set: { status: "done", ...done }, $unset: { claimToken: 1 } },
  ).catch((error) => console.error("[drive-photos] could not record the import of %s", driveFileId, error));
}

/**
 * Imports one Drive image as an item's photo. Skips it when that Drive file was imported before (even
 * if that photo was changed or removed since), or when the item has a photo and `replace` is off.
 * Checked again here: the review may be minutes old.
 */
export async function importDrivePhoto(
  input: { driveFileId: string; name: string; itemId: string; replace: boolean },
  userId: string,
): Promise<DrivePhotoOutcome> {
  assertConfigured();
  const { driveFileId, itemId, replace } = input;
  if (!DRIVE_ID.test(driveFileId)) throw new AppError("Invalid Drive file id.");
  if (!Types.ObjectId.isValid(itemId)) throw new AppError("Invalid item.");

  const claim = await claimDriveFile(driveFileId, userId);
  if ("skip" in claim) return { status: "skipped", reason: claim.skip, itemId };
  const { token } = claim;

  let finished = false;
  try {
    // Photos saved on an item before the import log existed, or by an import cut off before it was
    // recorded. An unowned copy is left over from an import cut off before it reached the item: with
    // the claim held, nothing else can be using it, so it is deleted and the file imported again.
    const orphans = await FileModel.find({ kind: "photo", driveFileId, $or: [{ "entity.id": { $exists: false } }, { "entity.id": null }] })
      .select("_id")
      .lean();
    for (const orphan of orphans) await removeFile(String(orphan._id)).catch(() => undefined);
    const earlier = await FileModel.findOne({ kind: "photo", driveFileId, "entity.type": "item", "entity.id": { $ne: null } })
      .select("entity")
      .lean();
    if (earlier?.entity?.id) {
      await finishClaim(driveFileId, token, { file: earlier._id, item: earlier.entity.id });
      finished = true;
      return { status: "skipped", reason: IMPORTED_BEFORE, itemId };
    }

    const item = await InventoryItem.findOne({ _id: new Types.ObjectId(itemId), archivedAt: null }).select("photoFileId").lean();
    if (!item) throw new AppError("The item was not found. It may have been archived or deleted.", "not_found");
    if (item.photoFileId && !replace) return { status: "skipped", reason: "The item already has a photo.", itemId };

    const downloaded = await downloadDriveFile(driveFileId, MAX_UPLOAD_BYTES).catch(asAppError);
    const sniffed = sniffImageType(downloaded);
    if (!sniffed) throw new AppError("This file is not a PNG, JPEG, WebP or GIF image.");
    const photo = await shrinkPhoto({ bytes: downloaded, mimeType: sniffed, name: input.name });

    const stored = await storeBuffer({ ...photo, kind: "photo", userId, driveFileId }).catch(asAppError);
    const outcome = await assignItemPhoto({ itemId, fileId: String(stored._id), replace, uploadedBy: userId });
    if (outcome.status === "saved") {
      await finishClaim(driveFileId, token, { item: new Types.ObjectId(itemId), file: stored._id });
      finished = true;
    }
    return { ...outcome, itemId };
  } finally {
    if (!finished) await releaseClaim(driveFileId, token);
  }
}
