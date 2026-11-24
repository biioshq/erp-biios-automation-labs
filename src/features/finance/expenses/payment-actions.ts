"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Expense } from "@/server/models";
import { endOfDayIST, fromDateInput } from "@/lib/dates";
import { formatCurrency, round2 } from "@/lib/format";
import { paymentState } from "@/lib/payments";
import type { ExpenseSource } from "@/lib/constants";
import { unmatchHint } from "@/features/finance/bank-statements/line-href";
import { expensePaymentIdSchema, expensePaymentSchema } from "./schemas";
import { takesPayments } from "./sources";
import { HALF_PAISA, assertAccountUsable, assertMaySalary, toObjectId } from "./server";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

const changedMeanwhile = () =>
  new AppError("This expense changed a moment ago (someone else may have recorded a payment). Check what is still owed and try again.", "conflict");

/** Expenses whose payments are kept by another record, or that are not a company cost of their own. */
function assertTakesPayments(e: { source?: string | null; countedAtPurchase?: boolean | null }) {
  const source = (e.source ?? "manual") as ExpenseSource;
  if (e.countedAtPurchase === true || !takesPayments(source)) {
    const why =
      source === "liability_interest"
        ? "Loan interest is paid through the loan's repayments."
        : "This expense moves no money: the stock was paid for when it was bought.";
    throw new AppError(`Payments can't be recorded on this expense. ${why}`, "conflict");
  }
}

/**
 * Records a payment against an expense. An expense without a payments list that is "On credit"
 * starts one; one paid in full on its date has nothing outstanding and is refused. The amount can
 * be at most what is still owed. The write only lands if the expense is unchanged since it was
 * read, so two people paying the same bill at once cannot pay it twice.
 */
export const recordExpensePayment = defineAction(
  expensePaymentSchema,
  async (input, user) => {
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
    const amount = round2(input.amount);
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
    return { id: input.id, paymentId: String(paymentId), outstanding: round2(Math.max(0, outstanding - amount)) };
  },
  { revalidate: REVALIDATE, message: "Payment recorded" },
);

/**
 * Removes one recorded payment (admins only). The list stays even when it becomes empty: an empty
 * list means nothing paid, while no list would mean paid in full on the expense date.
 */
export const deleteExpensePayment = defineAction(
  expensePaymentIdSchema,
  async ({ id, paymentId }) => {
    const existing = await Expense.findById(id, { source: 1, countedAtPurchase: 1, payments: 1 }).lean();
    if (!existing) throw notFound("The expense");
    assertTakesPayments(existing);
    const payment = (existing.payments ?? []).find((p) => String((p as { _id?: unknown })._id) === paymentId);
    if (!payment) throw notFound("The payment");
    if (payment.bankTransaction) {
      throw new AppError(`This payment is matched to a bank statement line, so it can't be deleted here.${unmatchHint([String(payment.bankTransaction)])}`, "conflict");
    }
    const pid = new Types.ObjectId(paymentId);
    const res = await Expense.updateOne({ _id: existing._id, "payments._id": pid }, { $pull: { payments: { _id: pid } } });
    if (!res.modifiedCount) throw notFound("The payment");
    return { id, paymentId };
  },
  { revalidate: REVALIDATE, message: "Payment deleted", role: "admin" },
);
