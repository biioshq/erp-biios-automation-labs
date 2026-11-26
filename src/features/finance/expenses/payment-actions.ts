"use server";

import { defineAction } from "@/server/action";
import { AppError } from "@/server/errors";
import { expensePaymentIdSchema, expensePaymentSchema, markExpensePaidSchema, markExpensesPaidSchema, undoExpensePaymentsSchema } from "./schemas";
import { applyExpensePayment, removeExpensePayment } from "./payment-core";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/**
 * Records a payment against an expense (Record payment). The guarded write is applyExpensePayment
 * (payment-core.ts), shared with Mark as paid, so two people paying the same bill at once cannot
 * pay it twice.
 */
export const recordExpensePayment = defineAction(
  expensePaymentSchema,
  async (input, user) => {
    const done = await applyExpensePayment(input, user);
    return { id: done.id, paymentId: done.paymentId, outstanding: done.outstanding };
  },
  { revalidate: REVALIDATE, message: "Payment recorded", permission: "finance.payments:create" },
);

/**
 * Mark as paid (Outstanding payments): one payment for the amount shown, on the day picked, from the
 * account picked. The same write as Record payment; the expense and its date stay as they are.
 */
export const markExpensePaid = defineAction(
  markExpensePaidSchema,
  async (input, user) => applyExpensePayment(input, user),
  { revalidate: REVALIDATE, message: "Marked as paid", permission: "finance.payments:create" },
);

export type BulkPaidResult = {
  paid: { id: string; paymentId: string; amount: number }[];
  failed: { id: string; error: string }[];
};

/**
 * Mark selected as paid: each expense gets one payment for what it still owes, all on one day from
 * one account. One at a time through the same guarded write. A bill that owes something other than
 * what the dialog showed (`expected`), or that changed meanwhile, is reported back and the others
 * still go through.
 */
export const markExpensesPaid = defineAction(
  markExpensesPaidSchema,
  async ({ ids, expected, ...rest }, user): Promise<BulkPaidResult> => {
    const result: BulkPaidResult = { paid: [], failed: [] };
    const owedSeen = new Map((expected ?? []).map((e) => [e.id, e.outstanding]));
    for (const id of [...new Set(ids)]) {
      try {
        const done = await applyExpensePayment({ ...rest, id, amount: "full", expectedOutstanding: owedSeen.get(id) }, user);
        result.paid.push({ id, paymentId: done.paymentId, amount: done.amount });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        result.failed.push({ id, error: error.message });
      }
    }
    return result;
  },
  { revalidate: REVALIDATE, permission: "finance.payments:create" },
);

/**
 * Undo after Mark as paid: removes exactly the payments just recorded. Allowed for the person who
 * recorded them within 15 minutes; otherwise it needs the payments delete permission. Payments
 * matched to a bank statement line are never removed here.
 */
export const undoExpensePayments = defineAction(
  undoExpensePaymentsSchema,
  async ({ payments }, user) => {
    const undone: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const p of payments) {
      try {
        await removeExpensePayment(p, user, { allowOwnRecent: true, restoreCredit: true });
        undone.push(p.paymentId);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        failed.push({ id: p.id, error: error.message });
      }
    }
    if (!undone.length && failed.length) throw new AppError(failed[0].error, "conflict");
    return { undone, failed };
  },
  { revalidate: REVALIDATE, message: "Payment undone", permission: ["finance.payments:create", "finance.payments:delete"] },
);

/**
 * Removes one recorded payment (needs the payments delete permission). The list stays even when it becomes empty: an empty
 * list means nothing paid, while no list would mean paid in full on the expense date.
 */
export const deleteExpensePayment = defineAction(
  expensePaymentIdSchema,
  async (input, user) => removeExpensePayment(input, user, { allowOwnRecent: false }),
  { revalidate: REVALIDATE, message: "Payment deleted", permission: "finance.payments:delete" },
);
