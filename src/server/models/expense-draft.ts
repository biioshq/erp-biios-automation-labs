import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

export const EXPENSE_DRAFT_STATUSES = ["reading", "ready", "saving", "saved", "discarded"] as const;
export type ExpenseDraftStatus = (typeof EXPENSE_DRAFT_STATUSES)[number];

/**
 * A bill imported from Google Drive, waiting to be checked and saved as an expense.
 *
 *   reading   the file is stored and the receipt reader is running
 *   ready     waiting for review (values hold what was read, then the reviewer's edits)
 *   saving    being saved as an expense right now (guards against saving twice)
 *   saved     the expense exists (`expense`), the draft is kept so the Drive file is never imported again
 *   discarded the stored receipt was deleted, the draft is kept for the same reason
 *
 * Drafts are never shown as expenses and never count in any total.
 */
const expenseDraftSchema = new Schema(
  {
    /** The Drive file this draft came from. Checked before importing, so a file is imported once. */
    driveFileId: { type: String, required: true, trim: true, maxlength: 200 },
    /** The shared folder it was listed from, when it came from a folder. */
    driveFolderId: { type: String, trim: true, maxlength: 200 },
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, trim: true, maxlength: 120 },
    /** The stored receipt (files collection). Removed when the draft is discarded. */
    file: { type: Schema.Types.ObjectId, ref: "File" },
    status: { type: String, enum: EXPENSE_DRAFT_STATUSES, required: true, default: "reading" },
    /** The expense form's values (vendor, date "yyyy-mm-dd", amount, gst ...), filled from the receipt, then edited. */
    values: { type: Schema.Types.Mixed, default: () => ({}) },
    /** What the receipt reader found: overall confidence, how it read the file, and a confidence per form field ("gst__gstin"). */
    ocr: {
      type: new Schema({ overall: Number, source: String, fields: { type: Schema.Types.Mixed } }, { _id: false }),
      default: undefined,
    },
    /** Why the reader could not fill the draft (the draft is still kept, to fill in by hand). */
    ocrError: { type: String, trim: true, maxlength: 500 },
    readAt: { type: Date },
    expense: { type: Schema.Types.ObjectId, ref: "Expense" },
    /**
     * Written when a save starts, before the expense is created, so a save cut off half way can be
     * matched to the expense it made (who saved, from when, and the vendor, amount and date saved).
     */
    savingSince: { type: Date },
    savingBy: { type: Schema.Types.ObjectId, ref: "User" },
    savingKey: {
      type: new Schema({ vendor: String, amount: Number, date: String }, { _id: false }),
      default: undefined,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    savedBy: { type: Schema.Types.ObjectId, ref: "User" },
    savedAt: { type: Date },
    discardedBy: { type: Schema.Types.ObjectId, ref: "User" },
    discardedAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);
// Plain (not unique) indexes: the app checks for an existing draft itself, so it works before they exist.
expenseDraftSchema.index({ driveFileId: 1 });
expenseDraftSchema.index({ status: 1, createdAt: -1 });

export type ExpenseDraftDoc = InferSchemaType<typeof expenseDraftSchema> & { _id: Types.ObjectId };
export const ExpenseDraft: Model<ExpenseDraftDoc> =
  models.ExpenseDraft ?? model<ExpenseDraftDoc>("ExpenseDraft", expenseDraftSchema, "expenseDrafts");
