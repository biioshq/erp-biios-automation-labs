import { splitGst } from "@/lib/gst";
import { round2 } from "@/lib/format";

/** GST rates an invoice line can carry. Client-safe, shared by the form preview and the server. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

export type LineInput = { quantity: number; rate: number; gstRate: number };

export type InvoiceTotals = {
  /** Each line's quantity x rate, in the order given. */
  lineAmounts: number[];
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

/**
 * Totals of an invoice. Each line's amount is rounded to paise, then its tax is split the way a tax
 * invoice prints it (src/lib/gst.ts splitGst: equal CGST and SGST halves within the state, IGST
 * across states) and the heads are summed. The server stores exactly what this returns.
 */
export function invoiceTotals(lines: LineInput[], interState: boolean): InvoiceTotals {
  let taxableAmount = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  const lineAmounts = lines.map((l) => {
    const amount = round2((Number(l.quantity) || 0) * (Number(l.rate) || 0));
    const tax = splitGst(amount, Number(l.gstRate) || 0, interState);
    taxableAmount += amount;
    cgst += tax.cgst;
    sgst += tax.sgst;
    igst += tax.igst;
    return amount;
  });
  taxableAmount = round2(taxableAmount);
  cgst = round2(cgst);
  sgst = round2(sgst);
  igst = round2(igst);
  return { lineAmounts, taxableAmount, cgst, sgst, igst, total: round2(taxableAmount + cgst + sgst + igst) };
}
