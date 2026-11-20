import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { PROJECT_DOCUMENT_TYPES, valuesOf } from "@/lib/constants";

/** "photo": an inventory item's picture. */
export const FILE_KINDS = ["receipt", "document", "attachment", "photo"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Metadata for a stored upload. The bytes live in local storage under `storageKey`. */
const fileSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true, unique: true },
    checksum: { type: String },
    kind: { type: String, enum: FILE_KINDS, required: true },
    /** Project documents only: quotation, bill, drawing … */
    documentType: { type: String, enum: valuesOf(PROJECT_DOCUMENT_TYPES) },
    project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    /** What the file belongs to, when it belongs to one record. */
    entity: {
      type: { type: String, enum: ["expense", "income", "task", "project", "movement", "item"] },
      id: { type: Schema.Types.ObjectId },
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    /** The Google Drive file this was imported from, so the same Drive file is not imported twice. */
    driveFileId: { type: String },
  },
  { timestamps: true },
);
fileSchema.index({ "entity.type": 1, "entity.id": 1 });
// Lookups by driveFileId also work before this index exists (Vercel does not run the database setup).
fileSchema.index({ driveFileId: 1 }, { sparse: true });

export type FileDoc = InferSchemaType<typeof fileSchema> & { _id: Types.ObjectId };
export const FileModel: Model<FileDoc> = models.File ?? model<FileDoc>("File", fileSchema, "files");

/**
 * Drive files already imported, kept apart from the File record: changing or removing a photo deletes
 * that record, and the same Drive file must still count as imported afterwards. Done records are never
 * deleted.
 *
 * The `_id` is `<kind>:<driveFileId>` (driveImportKey), so inserting one is an atomic claim through the
 * index every collection has: two imports of the same file at once cannot both win, and no new index
 * is needed (Vercel does not run the database setup). A "pending" claim belongs to a running import; it
 * is removed when that import stops without saving, and can be taken over once it is stale.
 * "item_photo": an image saved as an inventory item's photo.
 */
const driveImportSchema = new Schema(
  {
    _id: { type: String, required: true },
    driveFileId: { type: String, required: true },
    kind: { type: String, enum: ["item_photo"], required: true },
    status: { type: String, enum: ["pending", "done"], required: true },
    claimToken: { type: String },
    claimedAt: { type: Date },
    item: { type: Schema.Types.ObjectId, ref: "InventoryItem" },
    /** The File stored by the import. It may since have been replaced or removed. */
    file: { type: Schema.Types.ObjectId, ref: "File" },
    importedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type DriveImportKind = "item_photo";
export const driveImportKey = (kind: DriveImportKind, driveFileId: string) => `${kind}:${driveFileId}`;

export type DriveImportDoc = InferSchemaType<typeof driveImportSchema>;
export const DriveImport: Model<DriveImportDoc> =
  models.DriveImport ?? model<DriveImportDoc>("DriveImport", driveImportSchema, "driveImports");
