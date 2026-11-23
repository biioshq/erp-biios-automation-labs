/**
 * What was paid on an expense, and what is still owed. Client-safe and pure, so lists, the
 * payables page and the accounting engine all compute it one way.
 *
 * An expense without `payments` (every expense saved before part payments existed) is settled the
 * way it always was: paid in full on its own date with its own method, unless the method is
 * "On credit", which means not paid yet. An expense with `payments` is paid exactly what they add up to.
 */

import type { PaymentMethod, PaymentStatus } from "./constants";
import { startOfDayIST } from "./dates";

export type PaymentLike = {
  date: Date | string;
  amount: number;
  paymentMethod: PaymentMethod | string;
  account?: unknown;
  reference?: string | null;
  note?: string | null;
};

export type ExpenseLike = {
  amount: number;
  date: Date | string;
  paymentMethod: PaymentMethod | string;
  account?: unknown;
  dueDate?: Date | string | null;
  payments?: PaymentLike[] | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The payments an expense counts, explicit or implied (see the header). */
export function effectivePayments(e: ExpenseLike): PaymentLike[] {
  if (Array.isArray(e.payments)) return e.payments;
  if (e.paymentMethod === "credit") return [];
  // Generated stock assignments ("From stock") move no money; they are not payable either.
  return [{ date: e.date, amount: e.amount, paymentMethod: e.paymentMethod, account: e.account }];
}

export type PaymentState = {
  paid: number;
  outstanding: number;
  status: PaymentStatus;
  lastPaidOn: Date | null;
  /** When the outstanding part is due: the due date, or the expense date when none was given. */
  dueOn: Date | null;
};

/** Paid, outstanding and status of an expense as of `now` (IST days). */
export function paymentState(e: ExpenseLike, now: Date = new Date()): PaymentState {
  const payments = effectivePayments(e);
  const paid = round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const outstanding = round2(Math.max(0, e.amount - paid));
  const last = payments.reduce<Date | null>((d, p) => {
    const t = new Date(p.date);
    return !d || t.getTime() > d.getTime() ? t : d;
  }, null);
  const dueOn = outstanding > 0 ? new Date(e.dueDate ?? e.date) : null;
  let status: PaymentStatus;
  if (outstanding <= 0.005) status = "paid";
  else if (dueOn && dueOn.getTime() < startOfDayIST(now).getTime()) status = "overdue";
  else status = paid > 0 ? "partial" : "unpaid";
  return { paid, outstanding: outstanding <= 0.005 ? 0 : outstanding, status, lastPaidOn: last, dueOn };
}

/**
 * Mongo condition for expenses that may still be owed: method "On credit" (implied unpaid) or any
 * with explicit payments. Narrow with paymentState() afterwards.
 */
export function maybeUnpaidFilter(): { $or: Record<string, unknown>[] } {
  return { $or: [{ paymentMethod: "credit", payments: { $exists: false } }, { payments: { $exists: true } }] };
}
