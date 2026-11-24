import "server-only";

import { connectDB } from "@/server/db";
import { Expense } from "@/server/models";
import { salaryScope } from "@/server/auth/session";
import { ledgerAsOf } from "@/server/accounting/ledger";
import { loadExpenseCategories } from "@/server/expense-categories";
import { expenseCategoryLabel } from "@/lib/expense-categories";
import { paymentState } from "@/lib/payments";
import { startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { PaymentStatus } from "@/lib/constants";

const DAY = 86_400_000;

export type PrepaidStatus = "not_started" | "running" | "used_up" | "not_in_books";

export type PrepaidRow = {
  id: string;
  number: string;
  vendor: string;
  description: string | null;
  category: string;
  /** What the bill came to, GST included. */
  amount: number;
  /** The part carried as prepaid: the amount less GST input credit, as the books carry it. */
  prepaidValue: number;
  /** Used so far, as of today, spread evenly by day over the period. */
  used: number;
  remaining: number;
  date: string;
  /** Last payment date; null while nothing has been paid. */
  paidOn: string | null;
  paymentStatus: PaymentStatus;
  from: string;
  to: string;
  days: number;
  daysUsed: number;
  status: PrepaidStatus;
  /** Why a prepaid expense is not counted as prepaid, when it is not. */
  note: string | null;
};

export type PrepaidPage = {
  asOf: string;
  rows: PrepaidRow[];
  totalPrepaid: number;
  totalUsed: number;
  totalRemaining: number;
  /** Rows still holding a balance. */
  activeCount: number;
};

/** Why a prepaid expense shows no prepaid balance in the books, or a problem with its dates. */
function noteFor(
  e: { date: Date; source?: string | null; capitalAsset?: unknown; countedAtPurchase?: boolean | null },
  days: number,
  inBooks: boolean,
  asOf: Date,
): string | null {
  if (days === 0) return "The period ends before it starts. Fix the dates on the expense.";
  if (inBooks) return null;
  if (e.date.getTime() > asOf.getTime()) return "Dated after today: it enters the books on its date.";
  if (e.source === "inventory_purchase") return "A stock purchase: carried as inventory, not as prepaid.";
  if (e.capitalAsset) return "Paid for a fixed asset: carried in the asset register, not as prepaid.";
  if (e.countedAtPurchase) return "A project cost of stock bought earlier: not counted again.";
  return "Not counted as prepaid.";
}

/**
 * Expenses paid for a period (Expense.prepaid). The prepaid value, what has been used and what is
 * left come from the accounting engine's own postings to the Prepaid expenses account, so the
 * total here is the balance sheet's Prepaid expenses line.
 */
export async function getPrepaid(now: Date = new Date()): Promise<PrepaidPage> {
  await connectDB();
  const [docs, ledger, categories, scope] = await Promise.all([
    Expense.find(
      { prepaid: { $exists: true }, "prepaid.from": { $type: "date" } },
      { number: 1, vendor: 1, description: 1, category: 1, amount: 1, date: 1, paymentMethod: 1, payments: 1, account: 1, dueDate: 1, prepaid: 1, source: 1, capitalAsset: 1, countedAtPurchase: 1 },
    )
      .sort({ "prepaid.to": -1 })
      .lean(),
    ledgerAsOf(now),
    loadExpenseCategories(),
    salaryScope(),
  ]);
  const hidden = "category" in scope ? new Set(["salaries"]) : new Set<string>();

  // Prepaid account postings per expense: the debit when it was booked, credits as days are used.
  const booked = new Map<string, { value: number; used: number }>();
  for (const p of ledger.postings) {
    if (p.account !== "prepaid") continue;
    const b = booked.get(p.source.id) ?? { value: 0, used: 0 };
    if (p.source.kind === "expense") b.value = round2(b.value + p.amount);
    else b.used = round2(b.used - p.amount);
    booked.set(p.source.id, b);
  }

  const today = startOfDayIST(ledger.asOf).getTime();
  const rows: PrepaidRow[] = [];
  for (const e of docs) {
    if (!e.prepaid?.from || !e.prepaid?.to || hidden.has(e.category)) continue;
    const id = String(e._id);
    const start = startOfDayIST(e.prepaid.from).getTime();
    const end = startOfDayIST(e.prepaid.to).getTime();
    const days = end >= start ? Math.round((end - start) / DAY) + 1 : 0;
    const daysUsed = today < start ? 0 : Math.min(days, Math.round((Math.min(today, end) - start) / DAY) + 1);
    const b = booked.get(id);
    const state = paymentState(e, now);
    const note = noteFor(e, days, Boolean(b), ledger.asOf);
    const prepaidValue = b?.value ?? 0;
    const used = b?.used ?? 0;
    const remaining = round2(prepaidValue - used);
    rows.push({
      id,
      number: e.number,
      vendor: e.vendor,
      description: e.description ?? null,
      category: expenseCategoryLabel(categories, e.category),
      amount: e.amount,
      prepaidValue,
      used,
      remaining,
      date: toDateInput(e.date),
      paidOn: state.lastPaidOn && state.paid > 0 ? toDateInput(state.lastPaidOn) : null,
      paymentStatus: state.status,
      from: toDateInput(e.prepaid.from),
      to: toDateInput(e.prepaid.to),
      days,
      daysUsed,
      status: !b ? "not_in_books" : remaining <= 0.005 ? "used_up" : used <= 0 ? "not_started" : "running",
      note,
    });
  }
  // Holding a balance first (ends soonest first), then the used up and not counted ones.
  const order = { running: 0, not_started: 1, used_up: 2, not_in_books: 3 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status] || a.to.localeCompare(b.to));

  const sum = (pick: (r: PrepaidRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  return {
    asOf: toDateInput(ledger.asOf),
    rows,
    totalPrepaid: sum((r) => r.prepaidValue),
    totalUsed: sum((r) => r.used),
    totalRemaining: sum((r) => r.remaining),
    activeCount: rows.filter((r) => r.remaining > 0.005).length,
  };
}
