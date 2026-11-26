import type { IncomeCategory, PaymentMethod } from "@/lib/constants";

/** Income categories that are sales: a receipt in one of them normally has an invoice behind it. Client-safe. */
export const SALE_CATEGORIES: readonly IncomeCategory[] = ["project_payment", "product_sale", "retainer"];

/**
 * True for a receipt of a sale that is not linked to an invoice: the "No invoice" flag. Records
 * "On credit" or "From stock" moved no money and cannot be linked to an invoice, so they are not flagged.
 * Nothing is created automatically from this: the person chooses "Create invoice".
 */
export function needsInvoice(r: { category: IncomeCategory; invoice: unknown; paymentMethod: PaymentMethod }): boolean {
  return !r.invoice && SALE_CATEGORIES.includes(r.category) && r.paymentMethod !== "credit" && r.paymentMethod !== "stock";
}

/** The invoice form, prefilled from a receipt. */
export const createInvoiceHref = (incomeId: string) => `/finance/invoices?new=1&fromIncome=${incomeId}`;
