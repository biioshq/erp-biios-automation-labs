/**
 * OCR result types shared by the server (extraction) and the client (expense
 * form auto-fill and low-confidence highlighting). Client-safe.
 */

export const OCR_FIELD_KEYS = [
  "vendorName",
  "vendorAddress",
  "gstin",
  "invoiceNumber",
  "invoiceDate",
  "taxableAmount",
  "cgst",
  "sgst",
  "igst",
  "cess",
  "hsnSac",
  "totalAmount",
  "paymentMethod",
] as const;

export type OcrFieldKey = (typeof OCR_FIELD_KEYS)[number];

export type OcrField<T = string | number> = { value: T | null; confidence: number };

export type InvoiceExtraction = {
  vendorName: OcrField<string>;
  vendorAddress: OcrField<string>;
  gstin: OcrField<string>;
  invoiceNumber: OcrField<string>;
  /** ISO date, yyyy-mm-dd. */
  invoiceDate: OcrField<string>;
  taxableAmount: OcrField<number>;
  cgst: OcrField<number>;
  sgst: OcrField<number>;
  igst: OcrField<number>;
  cess: OcrField<number>;
  hsnSac: OcrField<string>;
  totalAmount: OcrField<number>;
  paymentMethod: OcrField<string>;
};


/** Fields below this confidence are highlighted for review in the UI. */
export const LOW_CONFIDENCE = 0.75;

/** What /api/ocr returns. */
export type OcrResponse = {
  file: import("@/features/files/types").FileDTO;
  ocr: { fields: InvoiceExtraction; overallConfidence: number; source: "image-ocr" | "pdf-text" | "pdf-ocr"; durationMs: number } | null;
  error?: string;
};
