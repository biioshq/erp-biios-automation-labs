import "server-only";

import { payablesSummary, receivablesSummary } from "@/server/finance/summaries";
import { addDays, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { NO_VENDOR, vendorKey } from "../dashboard/rules";
import type { OpenItems, PartyBalance } from "./types";

/**
 * Open payables and receivables for the insights pages. People who see salaries get the shared
 * summaries as they are. Others get supplier bills without salary bills: a salary bill names the
 * person paid.
 */

type Payables = Awaited<ReturnType<typeof payablesSummary>>;

export async function viewerPayables(seesSalaries: boolean, now: Date = new Date()): Promise<{ totals: OpenItems & { salariesLeftOut: boolean }; byVendor: PartyBalance[]; rows: Payables["rows"] }> {
  const summary = await payablesSummary(now);
  if (seesSalaries) {
    return {
      totals: { total: summary.total, count: summary.count, overdue: summary.overdue, overdueCount: summary.overdueCount, dueSoon: summary.dueSoon, salariesLeftOut: false },
      byVendor: summary.byVendor.map((v) => ({ name: v.vendor, outstanding: v.outstanding, count: v.bills, overdue: v.overdue })),
      rows: summary.rows,
    };
  }
  const rows = summary.rows.filter((r) => r.category !== "salaries");
  const today = toDateInput(now);
  const soon = toDateInput(addDays(now, 30));
  const byVendor = new Map<string, PartyBalance>();
  for (const r of rows) {
    const v = byVendor.get(r.vendor) ?? { name: r.vendor, outstanding: 0, count: 0, overdue: 0 };
    v.outstanding = round2(v.outstanding + r.outstanding);
    v.count += 1;
    if (r.status === "overdue") v.overdue = round2(v.overdue + r.outstanding);
    byVendor.set(r.vendor, v);
  }
  const overdue = rows.filter((r) => r.status === "overdue");
  return {
    totals: {
      total: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      count: rows.length,
      overdue: round2(overdue.reduce((s, r) => s + r.outstanding, 0)),
      overdueCount: overdue.length,
      dueSoon: round2(rows.filter((r) => r.status !== "overdue" && r.dueDate && r.dueDate >= today && r.dueDate <= soon).reduce((s, r) => s + r.outstanding, 0)),
      salariesLeftOut: rows.length !== summary.rows.length,
    },
    byVendor: [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding),
    rows,
  };
}

export async function receivables(now: Date = new Date()): Promise<{ totals: OpenItems; byClient: PartyBalance[] }> {
  const s = await receivablesSummary(now);
  return {
    totals: { total: s.total, count: s.count, overdue: s.overdue, overdueCount: s.overdueCount, dueSoon: s.dueSoon },
    byClient: s.byClient.map((c) => ({ name: c.client, outstanding: c.outstanding, count: c.invoices, overdue: c.overdue })),
  };
}

/** Groups names by vendorKey and picks one display spelling per vendor. */
export function vendorName(names: Map<string, string>, raw: string | null | undefined): { key: string; name: string } {
  const key = vendorKey(raw);
  const spelled = (raw ?? "").trim().replace(/\s+/g, " ");
  const seen = names.get(key);
  // Keep the first spelling, unless it is all lower case and a later one is not ("PCB Power Market").
  if (seen === undefined || (key && seen === seen.toLowerCase() && spelled !== spelled.toLowerCase())) names.set(key, key ? spelled : NO_VENDOR);
  return { key, name: names.get(key)! };
}
