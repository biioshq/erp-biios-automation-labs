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

/**
 * Tax for a taxable value at a rate: CGST+SGST halves within the state, IGST across states.
 * Each half is computed at half the rate and rounded on its own, as on a tax invoice, so the halves are always
 * equal (rounding the total first and splitting it gives 30.87 + 30.86 instead of 30.86 + 30.86).
 */
export function splitGst(taxable: number, ratePercent: number, interState: boolean): GstSplit {
  if (interState) return { cgst: 0, sgst: 0, igst: round2((taxable * ratePercent) / 100) };
  const half = round2((taxable * ratePercent) / 200);
  return { cgst: half, sgst: half, igst: 0 };
}

export function gstGrandTotal(g: { taxableAmount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null }) {
  return round2((g.taxableAmount ?? 0) + (g.cgst ?? 0) + (g.sgst ?? 0) + (g.igst ?? 0) + (g.cess ?? 0));
}

export function totalTax(g: { cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null }) {
  return round2((g.cgst ?? 0) + (g.sgst ?? 0) + (g.igst ?? 0) + (g.cess ?? 0));
}

export type GstIssue = { field: "igst" | "cgst" | "sgst" | "taxableAmount"; message: string };

/**
 * What is wrong with the tax heads of a bill (expense or stock purchase), for the form schemas to report on the
 * named field. Both feed the GST register and the input-credit totals, so both follow the same rules.
 */
export function gstIssues(g: { taxableAmount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null }): GstIssue[] {
  const issues: GstIssue[] = [];
  const cgst = g.cgst ?? 0;
  const sgst = g.sgst ?? 0;
  if ((g.igst ?? 0) > 0 && (cgst > 0 || sgst > 0)) {
    issues.push({ field: "igst", message: "Use IGST or CGST + SGST, not both" });
  } else if (Math.abs(Math.round(cgst * 100) - Math.round(sgst * 100)) > 2) {
    // CGST and SGST are equal halves of the in-state rate. A supplier's rounding can leave them a paisa apart, and
    // recurring postings made before the halves were rounded separately are up to 2 paisa apart; those must stay
    // editable. A real typo (90 and 9, or 90 and nothing) is far larger.
    // Which heads apply is not forced from the GSTIN state: a hotel or venue bill from another state rightly
    // carries CGST + SGST, because the place of supply decides.
    issues.push({ field: sgst === 0 ? "sgst" : "cgst", message: "CGST and SGST are equal halves" });
  }
  if ((g.taxableAmount ?? 0) <= 0 && totalTax(g) > 0) {
    // Without the taxable value the amount cannot be checked against the tax, and the tax would not add up.
    issues.push({ field: "taxableAmount", message: "Enter the taxable value for this tax" });
  }
  return issues;
}
