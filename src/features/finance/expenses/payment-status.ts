import "server-only";

import { addDays, endOfDayIST, startOfDayIST } from "@/lib/dates";
import type { PaymentStatus } from "@/lib/constants";

/**
 * paymentState() (src/lib/payments.ts) as MongoDB expressions, so lists can filter, count and total
 * by payment status in the database and get exactly what each row shows. Keep the two in step:
 *  - paid: the sum of `payments` when the array exists (an empty one is 0); otherwise 0 for
 *    "On credit" and the whole amount for any other method (paid on its date).
 *  - outstanding: amount less paid. Paid when that is at most half a paisa.
 *  - due: the due date, or the expense date when none was given. Overdue when that is before today (IST).
 *  - partly paid when something was paid, else unpaid.
 */

const HALF_PAISA = 0.005;

export const PAID_EXPR = {
  $cond: [{ $isArray: "$payments" }, { $sum: "$payments.amount" }, { $cond: [{ $eq: ["$paymentMethod", "credit"] }, 0, "$amount"] }],
};

export const OUTSTANDING_EXPR = { $max: [0, { $subtract: ["$amount", PAID_EXPR] }] };

export const DUE_EXPR = { $ifNull: ["$dueDate", "$date"] };

/** The status of one expense as of `now`: "paid", "overdue", "partial" or "unpaid". */
export function statusExpr(now: Date = new Date()) {
  return {
    $let: {
      vars: { paid: PAID_EXPR },
      in: {
        $switch: {
          branches: [
            { case: { $lte: [{ $subtract: ["$amount", "$$paid"] }, HALF_PAISA] }, then: "paid" },
            { case: { $lt: [DUE_EXPR, startOfDayIST(now)] }, then: "overdue" },
            { case: { $gte: ["$$paid", HALF_PAISA] }, then: "partial" },
          ],
          default: "unpaid",
        },
      },
    },
  };
}

/**
 * "From stock" rows (generated stock assignments) move no money, so they show no payment status
 * and match none of the status filters.
 */
export const NOT_FROM_STOCK = { paymentMethod: { $ne: "stock" } } as const;

/** Mongo condition: expenses whose status (as of `now`) is one of `statuses`. */
export function statusCondition(statuses: readonly PaymentStatus[], now: Date = new Date()) {
  return { $and: [NOT_FROM_STOCK, { $expr: { $in: [statusExpr(now), [...statuses]] } }] };
}

/** Due within the next 30 days (today included) and not paid: the same window as payablesSummary's "due soon". */
export function upcomingCondition(now: Date = new Date()) {
  return {
    $and: [
      NOT_FROM_STOCK,
      {
        $expr: {
          $and: [
            { $gt: [{ $subtract: ["$amount", PAID_EXPR] }, HALF_PAISA] },
            { $gte: [DUE_EXPR, startOfDayIST(now)] },
            { $lte: [DUE_EXPR, endOfDayIST(addDays(now, 30))] },
          ],
        },
      },
    ],
  };
}
