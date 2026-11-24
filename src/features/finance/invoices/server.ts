import "server-only";

import { Types } from "mongoose";
import { BankAccount, Income, Invoice, type InvoiceDoc } from "@/server/models";
import { AppError, notFound } from "@/server/errors";
import { invoiceBalances } from "@/server/finance/summaries";
import { formatCurrency, round2 } from "@/lib/format";
import { exactName } from "./queries";
import { OVERPAYMENT_FIELD } from "./schemas";

/**
 * Checks that a receipt may settle an invoice and returns that invoice. The invoice must be issued
 * (not cancelled) and belong to the receipt's client or project. The receipt may not take more than
 * is outstanding (not counting the receipt itself when it is being edited) unless the person
 * confirmed it, so a payment is never silently counted twice.
 */
export async function assertReceiptLink(input: {
  invoiceId: string;
  client: string;
  projectId?: string | null;
  amount: number;
  excludeIncomeId?: string;
  allowOverpayment?: boolean;
}): Promise<Pick<InvoiceDoc, "_id" | "number" | "client" | "project" | "total">> {
  const invoice = await Invoice.findById(input.invoiceId, { number: 1, client: 1, project: 1, total: 1, status: 1 }).lean();
  if (!invoice) throw notFound("The invoice");
  if (invoice.status === "cancelled") {
    throw new AppError(`${invoice.number} is cancelled. Restore it before recording a payment against it.`, "conflict", { invoiceId: ["This invoice is cancelled"] });
  }
  const sameClient = exactName(input.client).test(invoice.client.trim());
  const sameProject = Boolean(input.projectId && invoice.project && String(invoice.project) === input.projectId);
  if (!sameClient && !sameProject) {
    throw new AppError(`${invoice.number} is an invoice to ${invoice.client}, not ${input.client}.`, "invalid", { invoiceId: ["This invoice is for another customer"] });
  }
  const [balance] = await invoiceBalances(new Date(), { _id: invoice._id });
  let received = balance?.received ?? 0;
  if (input.excludeIncomeId) {
    const own = await Income.findOne({ _id: new Types.ObjectId(input.excludeIncomeId), invoice: invoice._id }, { amount: 1 }).lean();
    if (own) received = round2(received - own.amount);
  }
  const outstanding = round2(Math.max(0, invoice.total - received));
  if (!input.allowOverpayment && round2(input.amount) > outstanding) {
    const message =
      outstanding <= 0
        ? `${invoice.number} is already fully received. Confirm to record this amount against it anyway.`
        : `Only ${formatCurrency(outstanding, { exact: true })} is outstanding on ${invoice.number}. Confirm to record more than that.`;
    throw new AppError(message, "conflict", { [OVERPAYMENT_FIELD]: [message], amount: ["More than is outstanding"] });
  }
  return invoice;
}

/** A bank or cash account picked on a form must exist. Archived ones are refused unless already on the record. */
export async function assertAccount(accountId: string | undefined, keep?: unknown) {
  if (!accountId) return;
  if (keep && String(keep) === accountId) return;
  const ok = await BankAccount.exists({ _id: new Types.ObjectId(accountId), archivedAt: null });
  if (!ok) throw new AppError("That account can't be used. Pick another one.", "invalid", { accountId: ["Pick an open account"] });
}
