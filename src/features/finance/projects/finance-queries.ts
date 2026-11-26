import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Income, Invoice } from "@/server/models";
import { projectPaymentSplit, projectSpend } from "@/server/services/metrics";
import { invoiceBalances } from "@/server/finance/summaries";
import { round2 } from "@/lib/format";
import { PROJECT_STAGES, type ProjectStage } from "@/lib/constants";
import { emptyPayables, emptyRevenue, emptySpendByType, spendTypeOf, type ProjectFinance } from "./finance";

/**
 * Revenue, receipts, receivables, spend by type and paid / outstanding payables per project, in one batch. Spend is
 * projectSpend's (the source of truth, salaries left out for members); the split by type uses the
 * same filter, so its parts always add up to that spend.
 */

type Options = { includeSalaries?: boolean; now?: Date };

/** The viewer's default, imported lazily so scripts can pass includeSalaries without a request. */
async function seesSalaries(options: Options) {
  if (options.includeSalaries !== undefined) return options.includeSalaries;
  const { canSeeSalaries } = await import("@/server/auth/session");
  return canSeeSalaries();
}

/** Spend per project and category, matched exactly as projectSpend matches it. */
async function spendByCategory(match: Record<string, unknown>, includeSalaries: boolean) {
  return Expense.aggregate<{ _id: { project: Types.ObjectId; category: string }; total: number }>([
    { $match: includeSalaries ? match : { ...match, category: { $ne: "salaries" } } },
    { $group: { _id: { project: "$project", category: "$category" }, total: { $sum: "$amount" } } },
  ]);
}

/**
 * Income for these projects that is not counted through an invoice. A receipt linked to an
 * invoice that belongs to a project is part of that invoice; one linked to a cancelled invoice,
 * or to an invoice without a project, stays with its own project.
 */
async function directReceipts(match: Record<string, unknown>) {
  const income = await Income.find(match, { project: 1, invoice: 1, amount: 1 }).lean();
  const linked = [...new Set(income.filter((i) => i.invoice).map((i) => String(i.invoice)))];
  const counted = linked.length
    ? await Invoice.find({ _id: { $in: linked.map((id) => new Types.ObjectId(id)) }, status: { $ne: "cancelled" }, project: { $ne: null } }, { _id: 1 }).lean()
    : [];
  const viaInvoice = new Set(counted.map((i) => String(i._id)));
  const out = new Map<string, number>();
  for (const i of income) {
    if (i.invoice && viaInvoice.has(String(i.invoice))) continue;
    const key = String(i.project);
    out.set(key, round2((out.get(key) ?? 0) + i.amount));
  }
  return out;
}

/** Finances of the given projects (all projects when no ids). */
export async function projectFinances(projectIds?: (string | Types.ObjectId)[], options: Options = {}): Promise<Map<string, ProjectFinance>> {
  await connectDB();
  const now = options.now ?? new Date();
  const includeSalaries = await seesSalaries(options);
  const ids = projectIds?.map((id) => new Types.ObjectId(String(id)));
  const match = ids ? { project: { $in: ids } } : { project: { $ne: null } };
  const [spend, categories, invoices, direct, payables] = await Promise.all([
    projectSpend(ids, { includeSalaries }),
    spendByCategory(match, includeSalaries),
    invoiceBalances(now, match),
    directReceipts(match),
    projectPaymentSplit(ids, { includeSalaries, now }),
  ]);

  const payablesOf = (id: string) => {
    const p = payables.get(id);
    if (!p) return emptyPayables(PROJECT_STAGES.map((s) => s.value));
    return { incurred: p.incurred, paid: p.paid, outstanding: p.outstanding, overdue: p.overdue, byStage: p.byStage, noStage: p.noStage };
  };

  const out = new Map<string, ProjectFinance>();
  const get = (id: string) => {
    let entry = out.get(id);
    if (!entry) {
      const s = spend.get(id);
      entry = {
        projectId: id,
        spent: s?.spent ?? 0,
        byType: emptySpendByType(),
        byStage: s?.byStage ?? (Object.fromEntries(PROJECT_STAGES.map((st) => [st.value, 0])) as Record<ProjectStage, number>),
        expenseCount: s?.expenseCount ?? 0,
        revenue: emptyRevenue(),
        payables: payablesOf(id),
        salariesHidden: !includeSalaries,
      };
      out.set(id, entry);
    }
    return entry;
  };
  for (const id of spend.keys()) get(id);
  ids?.forEach((id) => get(String(id)));

  for (const row of categories) {
    const entry = get(String(row._id.project));
    const type = spendTypeOf(row._id.category);
    entry.byType[type] = round2(entry.byType[type] + row.total);
  }
  for (const inv of invoices) {
    if (!inv.project) continue;
    const r = get(inv.project).revenue;
    r.invoiced = round2(r.invoiced + inv.total);
    r.invoiceCount += 1;
    r.receivedOnInvoices = round2(r.receivedOnInvoices + inv.received);
    r.outstanding = round2(r.outstanding + inv.outstanding);
    if (inv.status === "overdue") r.overdue = round2(r.overdue + inv.outstanding);
  }
  for (const [id, amount] of direct) get(id).revenue.receivedDirect = amount;
  for (const entry of out.values()) {
    // Both sums are rounded per group; a paisa of difference goes to "other" so the parts add up to the spend.
    const parts = round2(Object.values(entry.byType).reduce((s, v) => s + v, 0));
    const drift = round2(entry.spent - parts);
    if (drift !== 0 && Math.abs(drift) < 0.05) entry.byType.other = round2(entry.byType.other + drift);
    const r = entry.revenue;
    r.revenue = round2(r.invoiced + r.receivedDirect);
    r.received = round2(r.receivedOnInvoices + r.receivedDirect);
  }
  return out;
}
