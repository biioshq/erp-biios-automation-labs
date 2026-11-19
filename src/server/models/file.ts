import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { PROJECT_DOCUMENT_TYPES, valuesOf } from "@/lib/constants";

export const FILE_KINDS = ["receipt", "document", "attachment"] as const;
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
      type: { type: String, enum: ["expense", "income", "task", "project", "movement"] },
      id: { type: Schema.Types.ObjectId },
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
fileSchema.index({ "entity.type": 1, "entity.id": 1 });

export type FileDoc = InferSchemaType<typeof fileSchema> & { _id: Types.ObjectId };
export const FileModel: Model<FileDoc> = models.File ?? model<FileDoc>("File", fileSchema, "files");
