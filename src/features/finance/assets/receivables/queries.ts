import "server-only";

import { connectDB } from "@/server/db";
import { Project } from "@/server/models";
import { invoiceBalances, receivablesSummary, type ReceivableRow } from "@/server/finance/summaries";
import { balanceSheet } from "@/server/accounting/statements";
import { round2 } from "@/lib/format";

export type ReceivableItem = ReceivableRow & { projectName: string | null; projectColor: string | null };

export type OverpaidInvoice = { id: string; number: string; client: string; total: number; received: number; credit: number };

export type ReceivablesPage = {
  asOf: string;
  total: number;
  count: number;
  overdue: number;
  overdueCount: number;
  dueSoon: number;
  /** Invoiced and received over every issued invoice, open or settled. */
  invoicedAll: number;
  receivedAll: number;
  settledCount: number;
  byClient: { client: string; outstanding: number; invoices: number; overdue: number }[];
  /** Open invoices, overdue first, then by due date. */
  rows: ReceivableItem[];
  /**
   * Invoices received above their total, largest first. They owe nothing, so they are not in
   * `rows`; the extra is part of `customerAdvances` in the books.
   */
  overpaid: OverpaidInvoice[];
  /** Balance-sheet lines, so the page can show how it ties to the books. */
  sheetReceivables: number;
  customerAdvances: number;
};

const STATUS_RANK = { overdue: 0, partial: 1, unpaid: 2, paid: 3 } as const;

export async function getReceivables(now: Date = new Date()): Promise<ReceivablesPage> {
  await connectDB();
  const [summary, all, sheet] = await Promise.all([receivablesSummary(now), invoiceBalances(now), balanceSheet(now)]);
  const projectIds = [...new Set(summary.rows.map((r) => r.project).filter((p): p is string => Boolean(p)))];
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { name: 1, color: 1 }).lean() : [];
  const byId = new Map(projects.map((p) => [String(p._id), p]));

  const rows: ReceivableItem[] = summary.rows
    .map((r) => {
      const p = r.project ? byId.get(r.project) : undefined;
      return { ...r, projectName: p?.name ?? null, projectColor: p?.color ?? null };
    })
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date));

  const line = (lines: { key: string; amount: number }[], key: string) => lines.find((l) => l.key === key)?.amount ?? 0;
  return {
    asOf: sheet.asOf,
    total: summary.total,
    count: summary.count,
    overdue: summary.overdue,
    overdueCount: summary.overdueCount,
    dueSoon: summary.dueSoon,
    invoicedAll: round2(all.reduce((s, r) => s + r.total, 0)),
    receivedAll: round2(all.reduce((s, r) => s + Math.min(r.received, r.total), 0)),
    settledCount: all.filter((r) => r.outstanding <= 0).length,
    byClient: summary.byClient,
    rows,
    overpaid: all
      .filter((r) => (r.credit ?? 0) > 0 && r.date <= sheet.asOf)
      .map((r) => ({ id: r.id, number: r.number, client: r.client, total: r.total, received: r.received, credit: r.credit ?? 0 }))
      .sort((a, b) => b.credit - a.credit),
    sheetReceivables: line(sheet.assets.current, "receivables"),
    customerAdvances: line(sheet.liabilities.current, "customer_advances"),
  };
}
