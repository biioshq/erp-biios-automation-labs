import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { INVOICE_STATUSES, valuesOf } from "@/lib/constants";

const invoiceLineSchema = new Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 500 },
    quantity: { type: Number, min: 0, default: 1 },
    rate: { type: Number, min: 0, default: 0 },
    /** quantity × rate, before GST. */
    amount: { type: Number, min: 0, default: 0 },
    gstRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 0 },
    hsnSac: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false },
);

/**
 * A customer invoice. What was received against it is the income records that link it
 * (Income.invoice), so the balance and status are always computed, never stored.
 */
const invoiceSchema = new Schema(
  {
    /** The invoice number as printed; unique. */
    number: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    client: { type: String, required: true, trim: true, maxlength: 200 },
    clientGstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
    project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    date: { type: Date, required: true, index: true },
    dueDate: { type: Date, index: true },
    lines: { type: [invoiceLineSchema], default: [] },
    /** Intra-state invoices split GST into CGST and SGST; inter-state ones charge IGST. */
    interState: { type: Boolean, default: false },
    taxableAmount: { type: Number, min: 0, default: 0 },
    cgst: { type: Number, min: 0, default: 0 },
    sgst: { type: Number, min: 0, default: 0 },
    igst: { type: Number, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    status: { type: String, enum: valuesOf(INVOICE_STATUSES), default: "issued", index: true },
    notes: { type: String, trim: true, maxlength: 4000 },
    file: { type: Schema.Types.ObjectId, ref: "File" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
invoiceSchema.index({ client: 1 });
invoiceSchema.index({ client: "text", number: "text", notes: "text" });

export type InvoiceDoc = InferSchemaType<typeof invoiceSchema> & { _id: Types.ObjectId };
export const Invoice: Model<InvoiceDoc> = models.Invoice ?? model<InvoiceDoc>("Invoice", invoiceSchema, "invoices");
