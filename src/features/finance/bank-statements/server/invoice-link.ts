import "server-only";

import { Types } from "mongoose";
import { Income } from "@/server/models";
import { AppError } from "@/server/errors";
import { invoiceBalances } from "@/server/finance/summaries";
import { endOfDayIST, fromDateInput } from "@/lib/dates";
import { assertReceiptLink } from "@/features/finance/invoices/server";

/**
 * A deposit added as income that pays an open customer invoice is linked to it (Income.invoice), so
 * the invoice shows as paid. The invoice receipt rules decide, as when a receipt is linked by hand
 * (assertReceiptLink): never a cancelled invoice, the same client or project, and no more than is
 * still owed. When they refuse, the income is added unlinked as before and the results screen says why.
 */

export type ReceiptLink = { invoice: Types.ObjectId | null; number: string | null; note: string | null };

const NONE: ReceiptLink = { invoice: null, number: null, note: null };

/** The invoice the new income may be linked to, checked against the receipt rules. Reads only. */
export async function invoiceForReceipt(input: { invoiceId?: string; client: string; projectId?: string; amount: number; date: string }): Promise<ReceiptLink> {
  if (!input.invoiceId || !Types.ObjectId.isValid(input.invoiceId)) return NONE;
  // The books count a receipt from its date; one dated later than today cannot settle an invoice yet.
  if (fromDateInput(input.date).getTime() > endOfDayIST().getTime()) {
    return { ...NONE, note: "Not linked to the invoice: the line is dated later than today." };
  }
  try {
    const invoice = await assertReceiptLink({ invoiceId: input.invoiceId, client: input.client, projectId: input.projectId ?? null, amount: input.amount });
    return { invoice: invoice._id, number: invoice.number, note: `Linked to invoice ${invoice.number}.` };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    // The rules' own words, without the "Confirm to record more" offer the income form makes (there is no confirm here).
    const why = error.message.replace(/\s*Confirm to record[^.]*\.$/, "");
    return { ...NONE, note: `Not linked to the invoice: ${why} Link it from the income record if it pays that invoice.` };
  }
}

/**
 * After the income is saved: if another receipt was linked to the same invoice at the same moment
 * and the two together are more than the invoice, this one lets go of the link again, so a payment
 * is never counted twice against the invoice. Returns the note for the results screen.
 */
export async function confirmReceiptLink(incomeId: Types.ObjectId, link: ReceiptLink): Promise<string | null> {
  if (!link.invoice) return link.note;
  const [balance] = await invoiceBalances(new Date(), { _id: link.invoice });
  if (!balance || (balance.credit ?? 0) <= 0.005) return link.note;
  await Income.updateOne({ _id: incomeId, invoice: link.invoice }, { $unset: { invoice: 1 } });
  return `Not linked to invoice ${link.number}: it was paid by another receipt meanwhile. Link it from the income record if it pays that invoice.`;
}
