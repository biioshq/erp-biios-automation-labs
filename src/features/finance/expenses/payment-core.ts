import "server-only";

import { Types } from "mongoose";
import { AppError, notFound } from "@/server/errors";
import { Expense } from "@/server/models";
import { can, type SessionUser } from "@/server/auth/session";
import { endOfDayIST, fromDateInput } from "@/lib/dates";
import { formatCurrency, round2 } from "@/lib/format";
import { paymentState } from "@/lib/payments";
import type { ExpenseSource, PaymentMethod } from "@/lib/constants";
import { unmatchHint } from "@/features/finance/bank-statements/line-href";
import { takesPayments } from "./sources";
import { HALF_PAISA, assertAccountUsable, assertMaySalary, toObjectId } from "./server";
import { auditSafely } from "@/server/audit";
import { expensePaid, expensePaymentRemoved } from "@/features/finance/audit/records";

/**
 * The one guarded write that records a payment against an expense. Record payment, Mark as paid
 * and Mark selected as paid all go through it, so they refuse the same things and can never pay a
 * bill twice. It only ever appends to the expense's own `payments` (or starts that list on an "On
 * credit" expense): it never creates an expense and never changes the expense date.
 */

export const changedMeanwhile = () =>
  new AppError("This expense changed a moment ago (someone else may have recorded a payment). Check what is still owed and try again.", "conflict");

/** Expenses whose payments are kept by another record, or that are not a company cost of their own. */
export function assertTakesPayments(e: { source?: string | null; countedAtPurchase?: boolean | null }) {
  const source = (e.source ?? "manual") as ExpenseSource;
  if (e.countedAtPurchase === true || !takesPayments(source)) {
    const why =
      source === "liability_interest"
        ? "Loan interest is paid through the loan's repayments."
        : "This expense moves no money: the stock was paid for when it was bought.";
    throw new AppError(`Payments can't be recorded on this expense. ${why}`, "conflict");
  }
}

export type ApplyPaymentInput = {
  id: string;
  /** "yyyy-mm-dd" (IST day). */
  date: string;
  /** Rupees, or "full" for whatever is still owed when the expense is read. */
  amount: number | "full";
  /**
   * What the person saw as owed when they confirmed (Mark selected as paid). When the bill now owes
   * something else (its amount was edited, or someone paid part of it), nothing is written.
   */
  expectedOutstanding?: number;
  paymentMethod: PaymentMethod;
  accountId?: string;
  reference?: string;
  note?: string;
};

export type AppliedPayment = { id: string; paymentId: string; amount: number; outstanding: number };

/**
 * An expense without a payments list that is "On credit" starts one; one paid in full on its date has
 * nothing outstanding and is refused. The amount can be at most what is still owed. The write only
 * lands if the expense is unchanged since it was read (updatedAt and the list's length).
 */
export async function applyExpensePayment(input: ApplyPaymentInput, user: SessionUser): Promise<AppliedPayment> {
  const existing = await Expense.findById(input.id).lean();
  if (!existing) throw notFound("The expense");
  assertTakesPayments(existing);
  assertMaySalary(user, existing.category);
  const explicit = Array.isArray(existing.payments);
  if (!explicit && existing.paymentMethod !== "credit") {
    throw new AppError("This expense is recorded as paid in full on its date, so nothing is outstanding.", "conflict");
  }
  const { outstanding } = paymentState(existing);
  if (outstanding <= 0) throw new AppError("This expense is already paid in full.", "conflict");
  if (input.expectedOutstanding !== undefined && Math.abs(outstanding - input.expectedOutstanding) > HALF_PAISA) {
    const owed = formatCurrency(outstanding, { exact: true });
    throw new AppError(`This bill changed after the page loaded: ${owed} is owed now. Check it and try again.`, "conflict");
  }
  const amount = input.amount === "full" ? outstanding : round2(input.amount);
  if (!(amount > 0)) throw new AppError("Enter the amount paid.", "invalid", { amount: ["Enter the amount paid"] });
  if (amount > outstanding + HALF_PAISA) {
    const owed = formatCurrency(outstanding, { exact: true });
    throw new AppError(`Only ${owed} is still owed on this expense.`, "invalid", { amount: [`At most ${owed}`] });
  }
  const date = fromDateInput(input.date);
  if (date.getTime() > endOfDayIST().getTime()) {
    throw new AppError("A payment can't be dated in the future.", "invalid", { date: ["Pick today or an earlier day"] });
  }
  await assertAccountUsable(input.accountId);

  const paymentId = new Types.ObjectId();
  const payment = {
    _id: paymentId,
    date,
    amount,
    paymentMethod: input.paymentMethod,
    account: toObjectId(input.accountId),
    reference: input.reference,
    note: input.note,
    createdBy: new Types.ObjectId(user.id),
  };
  // Matching updatedAt is the guard: any other write since the read (a payment, an edit) changes it.
  // The array length is checked too, in case two writes land within the same millisecond.
  const guard = { _id: existing._id, updatedAt: existing.updatedAt ?? null };
  const res = explicit
    ? await Expense.updateOne({ ...guard, payments: { $size: existing.payments!.length } }, { $push: { payments: payment } })
    : await Expense.updateOne({ ...guard, payments: { $exists: false } }, { $set: { payments: [payment] } });
  if (!res.matchedCount) throw changedMeanwhile();
  const left = round2(Math.max(0, outstanding - amount));
  await auditSafely(() => expensePaid(existing, payment, { outstanding: left }));
  return { id: input.id, paymentId: String(paymentId), amount, outstanding: left };
}

/** How long the person who recorded a payment may take it back without the delete permission. */
export const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Removes one recorded payment. Never one matched to a bank statement line (that is undone by
 * unmatching the line). The person who recorded it may take it back within UNDO_WINDOW_MS; anyone
 * else, or later, needs the payments delete permission. The list stays even when it becomes empty:
 * an empty list means nothing paid, as deleteExpensePayment leaves it. With `restoreCredit` (Undo),
 * an "On credit" bill whose only payment this was gets back the shape it had before Mark as paid
 * (no payments list), so the expense form treats it as it did. Never for another method: there a
 * missing list would mean paid in full.
 */
export async function removeExpensePayment(
  { id, paymentId }: { id: string; paymentId: string },
  user: SessionUser,
  options: { allowOwnRecent: boolean; restoreCredit?: boolean },
  now: Date = new Date(),
): Promise<{ id: string; paymentId: string }> {
  const existing = await Expense.findById(id, { source: 1, countedAtPurchase: 1, payments: 1, category: 1, number: 1, vendor: 1 }).lean();
  if (!existing) throw notFound("The expense");
  // Payments on a salary expense are pay records, as when recording one.
  assertMaySalary(user, existing.category);
  assertTakesPayments(existing);
  type Stored = { _id?: Types.ObjectId; bankTransaction?: unknown; createdBy?: unknown; createdAt?: Date | null; date: Date; amount: number; paymentMethod?: string | null; account?: unknown };
  const payment = (existing.payments ?? []).find((p) => String((p as Stored)._id) === paymentId) as Stored | undefined;
  if (!payment) throw notFound("The payment");
  if (payment.bankTransaction) {
    throw new AppError(`This payment is matched to a bank statement line, so it can't be deleted here.${unmatchHint([String(payment.bankTransaction)])}`, "conflict");
  }
  const recordedAt = payment.createdAt ? new Date(payment.createdAt) : payment._id ? payment._id.getTimestamp() : null;
  const ownRecent =
    options.allowOwnRecent &&
    String(payment.createdBy ?? "") === user.id &&
    recordedAt !== null &&
    now.getTime() - recordedAt.getTime() <= UNDO_WINDOW_MS;
  if (!ownRecent && !can(user, "finance.payments:delete")) {
    throw new AppError(
      "Only the person who recorded this payment can undo it, within 15 minutes. After that an admin can delete it from Payment history.",
      "forbidden",
    );
  }
  const pid = new Types.ObjectId(paymentId);
  const removedNote = options.allowOwnRecent ? "Undone after Mark as paid" : undefined;
  if (options.restoreCredit) {
    const restored = await Expense.updateOne(
      { _id: existing._id, paymentMethod: "credit", payments: { $size: 1 }, "payments.0._id": pid, "payments.0.bankTransaction": null },
      { $unset: { payments: 1 } },
    );
    if (restored.modifiedCount) {
      await auditSafely(() => expensePaymentRemoved(existing, payment, removedNote));
      return { id, paymentId };
    }
  }
  const res = await Expense.updateOne(
    { _id: existing._id, payments: { $elemMatch: { _id: pid, bankTransaction: null } } },
    { $pull: { payments: { _id: pid } } },
  );
  if (!res.modifiedCount) throw notFound("The payment");
  await auditSafely(() => expensePaymentRemoved(existing, payment, removedNote));
  return { id, paymentId };
}
