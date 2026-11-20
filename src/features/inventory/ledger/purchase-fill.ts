import type { PurchaseFormValues } from "./schemas";

/** Purchase form helpers that are pure and client-safe. */

/**
 * The GSTIN and HSN/SAC the form filled from the last purchase, dropped again when nothing else of
 * the invoice was entered. A GSTIN alone records an invoice, so a cash or no-bill purchase saved
 * without touching the GST section must not claim one. Values the user typed (or changed) are kept.
 */
export function withoutUnusedInvoiceFill(
  values: PurchaseFormValues,
  auto: { "invoice.gstin"?: string; "invoice.hsnSac"?: string },
): PurchaseFormValues {
  const g = values.invoice;
  const entered =
    Boolean(g.invoiceNumber || g.invoiceDate) || [g.taxableAmount, g.cgst, g.sgst, g.igst, g.cess].some((n) => (n ?? 0) !== 0);
  if (entered) return values;
  // The schema trims and upper-cases the GSTIN, so compare the same way.
  const same = (value: string | undefined, filled: string | undefined) =>
    (value ?? "").trim().toUpperCase() === (filled ?? "").trim().toUpperCase();
  if (!same(g.gstin, auto["invoice.gstin"]) || !same(g.hsnSac, auto["invoice.hsnSac"])) return values;
  if (!g.gstin && !g.hsnSac) return values;
  return { ...values, invoice: { ...g, gstin: undefined, hsnSac: undefined } };
}
