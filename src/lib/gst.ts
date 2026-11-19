import { COMPANY } from "@/config/company";
import { round2 } from "./format";

/** GSTIN format: 2-digit state code, PAN, entity number, Z, check character. */
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** True when a supplier GSTIN is from another state (IGST applies). */
export function isInterState(gstin: string | null | undefined): boolean {
  if (!gstin || gstin.length < 2) return false;
  return gstin.slice(0, 2) !== COMPANY.stateCode;
}

export type GstSplit = { cgst: number; sgst: number; igst: number };

/** Tax for a taxable value at a rate: CGST+SGST halves within the state, IGST across states. */
export function splitGst(taxable: number, ratePercent: number, interState: boolean): GstSplit {
  const tax = round2((taxable * ratePercent) / 100);
  if (interState) return { cgst: 0, sgst: 0, igst: tax };
  const half = round2(tax / 2);
  return { cgst: half, sgst: round2(tax - half), igst: 0 };
}

export function gstGrandTotal(g: { taxableAmount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null }) {
  return round2((g.taxableAmount ?? 0) + (g.cgst ?? 0) + (g.sgst ?? 0) + (g.igst ?? 0) + (g.cess ?? 0));
}

export function totalTax(g: { cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null }) {
  return round2((g.cgst ?? 0) + (g.sgst ?? 0) + (g.igst ?? 0) + (g.cess ?? 0));
}
