import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * The company's business details, printed on invoices, receipts and statements. One document with
 * key "company" (the unique key keeps it single). Every detail is optional: one that is empty is
 * simply left off the documents. There is none until someone saves the details; until then the
 * name comes from src/config/company.ts.
 */
const text = (max: number) => ({ type: String, trim: true, maxlength: max });

const companyProfileSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "company" },
    legalName: text(200),
    tradeName: text(200),
    addressLine1: text(200),
    addressLine2: text(200),
    city: text(100),
    state: text(100),
    /** Two-digit GST state code, such as "27". */
    stateCode: text(2),
    pin: text(10),
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
    pan: { type: String, trim: true, uppercase: true, maxlength: 10 },
    /** CIN of a company or LLPIN of an LLP. */
    cin: { type: String, trim: true, uppercase: true, maxlength: 21 },
    phone: text(40),
    email: text(200),
    website: text(200),
    bankName: text(120),
    accountName: text(200),
    accountNumber: text(40),
    ifsc: { type: String, trim: true, uppercase: true, maxlength: 11 },
    branch: text(120),
    upiId: text(120),
    invoiceTerms: text(2000),
    footerNote: text(500),
    signatoryName: text(120),
    signatoryTitle: text(120),
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type CompanyProfileDoc = InferSchemaType<typeof companyProfileSchema> & { _id: Types.ObjectId };
export const CompanyProfile: Model<CompanyProfileDoc> =
  models.CompanyProfile ?? model<CompanyProfileDoc>("CompanyProfile", companyProfileSchema, "companyProfile");
