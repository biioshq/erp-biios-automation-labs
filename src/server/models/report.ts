import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { REPORT_FORMATS, REPORT_TYPES, valuesOf } from "@/lib/constants";

/** A log of generated report exports: who exported what, with which filters. */
const reportSchema = new Schema(
  {
    type: { type: String, enum: valuesOf(REPORT_TYPES), required: true },
    format: { type: String, enum: valuesOf(REPORT_FORMATS), required: true },
    title: { type: String, required: true },
    filters: { type: Schema.Types.Mixed, default: {} },
    rowCount: { type: Number, default: 0 },
    fileName: { type: String },
    generatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
reportSchema.index({ createdAt: -1 });

export type ReportDoc = InferSchemaType<typeof reportSchema> & { _id: Types.ObjectId };
export const Report: Model<ReportDoc> = models.Report ?? model<ReportDoc>("Report", reportSchema, "reports");
