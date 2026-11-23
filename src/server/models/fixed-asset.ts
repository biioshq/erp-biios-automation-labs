import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { ASSET_CONDITIONS, ASSET_FUNDING, DEPARTMENTS, DEPRECIATION_METHODS, PAYMENT_METHODS, valuesOf } from "@/lib/constants";

const maintenanceSchema = new Schema(
  {
    date: { type: Date, required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    /** What it cost. When the cost was booked, `expense` is that expense and its amount is the figure used. */
    cost: { type: Number, min: 0, default: 0 },
    vendor: { type: String, trim: true, maxlength: 200 },
    nextDueDate: { type: Date },
    expense: { type: Schema.Types.ObjectId, ref: "Expense" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

/**
 * A fixed asset (furniture, machinery, vehicles, buildings, computers) or an intangible one
 * (software, licences). Depreciation and book value are computed from the purchase cost, life and
 * method (src/lib/depreciation.ts), never stored. The purchase is recorded once: an asset bought
 * through an expense links that expense (`funding.expense`), whose cost then counts as the asset.
 */
const fixedAssetSchema = new Schema(
  {
    /** AST-0007 */
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: ["tangible", "intangible"], default: "tangible", index: true },
    /** A built-in group key (furniture_fixtures, software...) or a subgroup id. */
    group: { type: String, required: true, trim: true, maxlength: 80, index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    quantity: { type: Number, min: 0, default: 1 },
    purchaseDate: { type: Date, required: true },
    /** Total cost of all units, the amount capitalised (GST included unless it was claimed as credit). */
    purchaseCost: { type: Number, required: true, min: 0 },
    salvageValue: { type: Number, min: 0, default: 0 },
    usefulLifeYears: { type: Number, min: 0, default: 5 },
    depreciationMethod: { type: String, enum: valuesOf(DEPRECIATION_METHODS), default: "slm" },
    /** Yearly rate for written down value, in percent. */
    wdvRate: { type: Number, min: 0, max: 100 },
    /** Depreciation runs from this date (defaults to the purchase date, when put to use). */
    depreciationStart: { type: Date },
    vendor: { type: String, trim: true, maxlength: 200 },
    invoiceNumber: { type: String, trim: true, maxlength: 80 },
    location: { type: String, trim: true, maxlength: 120 },
    department: { type: String, enum: valuesOf(DEPARTMENTS) },
    assignedTo: { type: Schema.Types.ObjectId, ref: "Employee" },
    /** Equipment that can be allocated to projects (for analytics: availability and conflicts). */
    isEquipment: { type: Boolean, default: false },
    project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    /** Until when it is with that project. */
    projectUntil: { type: Date },
    condition: { type: String, enum: valuesOf(ASSET_CONDITIONS), default: "good" },
    warrantyUntil: { type: Date },
    warrantyNotes: { type: String, trim: true, maxlength: 1000 },
    maintenance: { type: [maintenanceSchema], default: [] },
    funding: {
      type: new Schema(
        {
          mode: { type: String, enum: valuesOf(ASSET_FUNDING), required: true },
          expense: { type: Schema.Types.ObjectId, ref: "Expense" },
          account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
          paymentMethod: { type: String, enum: valuesOf(PAYMENT_METHODS) },
        },
        { _id: false },
      ),
      required: true,
    },
    disposal: {
      type: new Schema(
        {
          date: { type: Date, required: true },
          /** Sale proceeds; 0 when scrapped or lost. */
          amount: { type: Number, min: 0, default: 0 },
          account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
          notes: { type: String, trim: true, maxlength: 1000 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    notes: { type: String, trim: true, maxlength: 4000 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
fixedAssetSchema.index({ "funding.expense": 1 }, { unique: true, partialFilterExpression: { "funding.expense": { $type: "objectId" } } });
fixedAssetSchema.index({ name: "text", code: "text", description: "text", location: "text" });

export type FixedAssetDoc = InferSchemaType<typeof fixedAssetSchema> & { _id: Types.ObjectId };
export const FixedAsset: Model<FixedAssetDoc> = models.FixedAsset ?? model<FixedAssetDoc>("FixedAsset", fixedAssetSchema, "fixedAssets");
