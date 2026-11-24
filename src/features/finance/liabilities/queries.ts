import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { BankAccount, Expense, FileModel, Liability, Project, type LiabilityDoc } from "@/server/models";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { liabilitiesOverview, liabilityState, payablesSummary } from "@/server/finance/summaries";
import { balanceSheet } from "@/server/accounting/statements";
import { canSeeSalaries } from "@/server/auth/session";
import { getExpenseCategories, getExpenseCategoryLabeler } from "@/server/expense-categories";
import { toFileDTO } from "@/features/files/server";
import { isCurrentLiabilityGroup, builtInGroup } from "@/lib/finance-groups";
import { addDays, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import type { LiabilityKind, LiabilitySource, LiabilityStatus, PaymentMethod } from "@/lib/constants";
import type { GroupOption } from "@/features/finance/groups/types";
import { canHoldRecords, COMPUTED_SOURCES, sideOf, type LiabilitySide } from "./groups";
import { emiSchedule } from "./schedule";
import type { DueBucket } from "./schemas";
import type { BillPaymentRow, DueItem, GroupSection, LiabilityDetail, LiabilityListRow, PayableListRow, RepaymentRow } from "./types";

/**
 * Reads for the Liabilities pages. Balances and status come from liabilityState and the payables
 * summary (src/server/finance/summaries.ts) and section totals from the balance sheet, so every
 * figure here matches the balance sheet and the Finance dashboard.
 */

type LeanLiability = LiabilityDoc;

export const loadLiabilityGroups = () => loadFinanceGroups("liability", { includeArchived: true });

/** Expense categories an accrued liability can be booked to: the visible ones, without Inventory (stock writes that one). */
export async function accruedCategoryOptions(): Promise<{ value: string; label: string }[]> {
  const categories = await getExpenseCategories();
  return categories.filter((c) => !c.hidden && c.value !== "inventory").map((c) => ({ value: c.value, label: c.label }));
}

function toRow(l: LeanLiability, groups: GroupOption[], now: Date): LiabilityListRow {
  const s = liabilityState(l, now);
  const group = groups.find((g) => g.key === l.group);
  const terms = {
    originalAmount: l.originalAmount,
    interestRate: l.interestRate ?? null,
    tenureMonths: l.tenureMonths ?? null,
    installment: l.installment ?? null,
    date: toDateInput(l.date),
  };
  const next = s.outstanding > 0 ? (emiSchedule(terms, s.principalPaid, now)?.next ?? null) : null;
  return {
    id: String(l._id),
    code: l.code,
    name: l.name,
    kind: (l.kind ?? "loan") as LiabilityKind,
    group: l.group,
    groupLabel: group?.label ?? builtInGroup(l.group)?.label ?? "Group removed",
    groupPath: group?.path ?? "",
    current: sideOf(groups, l.group) === "current_liabilities" || isCurrentLiabilityGroup(l.group),
    lender: l.lender,
    originalAmount: l.originalAmount,
    principalPaid: s.principalPaid,
    interestPaid: s.interestPaid,
    outstanding: s.outstanding,
    date: toDateInput(l.date),
    dueDate: l.dueDate ? toDateInput(l.dueDate) : null,
    interestRate: l.interestRate ?? null,
    tenureMonths: l.tenureMonths ?? null,
    installment: l.installment ?? null,
    status: s.status,
    lastPaymentDate: s.lastPaymentDate ? toDateInput(s.lastPaymentDate) : null,
    paymentCount: (l.payments ?? []).length,
    nextInstallment: next ? { date: next.dueDate, amount: next.installment, late: next.status === "due" } : null,
  };
}

/* Filters shared by the lists */

function inDueBucket(dueDate: string | null, outstanding: number, buckets: string[], now: Date): boolean {
  if (!buckets.length) return true;
  const today = toDateInput(now);
  const in7 = toDateInput(addDays(now, 7));
  const in30 = toDateInput(addDays(now, 30));
  return buckets.some((b) => {
    switch (b as DueBucket) {
      case "overdue":
        return Boolean(dueDate && dueDate < today && outstanding > 0);
      case "7d":
        return Boolean(dueDate && dueDate >= today && dueDate <= in7);
      case "30d":
        return Boolean(dueDate && dueDate >= today && dueDate <= in30);
      case "later":
        return Boolean(dueDate && dueDate > in30);
      case "none":
        return !dueDate;
      default:
        return false;
    }
  });
}

const inRange = (day: string | null, from: string | null, to: string | null) => (!from || (day !== null && day >= from)) && (!to || (day !== null && day <= to));

function filterLiabilities(rows: LiabilityListRow[], params: ListParams, now: Date): LiabilityListRow[] {
  const { lender = [], status = [], group = [], due = [] } = params.filters;
  const q = params.q ? searchRegex(params.q) : null;
  return rows.filter(
    (r) =>
      (!lender.length || lender.includes(r.lender)) &&
      (!status.length || status.includes(r.status)) &&
      (!group.length || group.includes(r.group)) &&
      inDueBucket(r.dueDate, r.outstanding, due, now) &&
      inRange(r.date, params.from, params.to) &&
      (!q || q.test(r.name) || q.test(r.code) || q.test(r.lender)),
  );
}

function sortRows<T>(rows: T[], sort: ListParams["sort"], pick: (row: T, key: string) => string | number | null): T[] {
  if (!sort) return rows;
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = pick(a, sort.id);
    const y = pick(b, sort.id);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * dir;
  });
}

function paginate<T>(rows: T[], params: ListParams): Paginated<T> {
  const pages = Math.max(1, Math.ceil(rows.length / params.pageSize));
  const page = Math.min(params.page, pages);
  return { rows: rows.slice((page - 1) * params.pageSize, page * params.pageSize), total: rows.length, page, pageSize: params.pageSize };
}

const sum = (values: number[]) => round2(values.reduce((s, v) => s + v, 0));

/* One liability */

export async function getLiability(id: string, now: Date = new Date()): Promise<LiabilityDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const l = await Liability.findById(id).populate<{ createdBy: { name?: string } | null }>("createdBy", "name").lean();
  if (!l) return null;
  const groups = await loadLiabilityGroups();
  const accountIds = [l.source?.account, ...(l.payments ?? []).map((p) => p.account)].filter(Boolean) as Types.ObjectId[];
  const expenseIds = (l.payments ?? []).map((p) => p.expense).filter(Boolean) as Types.ObjectId[];
  const [accounts, expenses, files, labelOfCategory] = await Promise.all([
    accountIds.length ? BankAccount.find({ _id: { $in: accountIds } }, { name: 1 }).lean() : [],
    expenseIds.length ? Expense.find({ _id: { $in: expenseIds } }, { number: 1 }).lean() : [],
    FileModel.find({ "entity.type": "liability", "entity.id": l._id }).sort({ createdAt: 1 }).lean(),
    getExpenseCategoryLabeler(),
  ]);
  const category = l.source?.mode === "accrued" ? (l.source.category ?? null) : null;
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const expenseNumber = new Map(expenses.map((e) => [String(e._id), e.number]));
  const row = toRow(l as unknown as LeanLiability, groups, now);
  const payments: RepaymentRow[] = (l.payments ?? [])
    .map((p) => ({
      id: String(p._id),
      date: toDateInput(p.date),
      principal: p.principal ?? 0,
      interest: p.interest ?? 0,
      total: round2((p.principal ?? 0) + (p.interest ?? 0)),
      paymentMethod: (p.paymentMethod ?? "bank_transfer") as PaymentMethod,
      account: p.account ? (accountName.get(String(p.account)) ?? null) : null,
      reference: p.reference ?? null,
      note: p.note ?? null,
      // A repayment whose interest expense was deleted elsewhere shows without the link.
      expense: p.expense && expenseNumber.has(String(p.expense)) ? { id: String(p.expense), number: expenseNumber.get(String(p.expense))! } : null,
      fromBankStatement: Boolean(p.bankTransaction),
      bankTransactionId: p.bankTransaction ? String(p.bankTransaction) : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    ...row,
    source: {
      mode: (l.source?.mode ?? "opening") as LiabilitySource,
      accountId: l.source?.account ? String(l.source.account) : null,
      accountName: l.source?.account ? (accountName.get(String(l.source.account)) ?? null) : null,
      paymentMethod: (l.source?.paymentMethod as PaymentMethod | undefined) ?? null,
      category,
      categoryLabel: category ? labelOfCategory(category) : null,
    },
    reference: l.reference ?? null,
    notes: l.notes ?? null,
    payments,
    documents: files.map((f) => toFileDTO(f)),
    fromBankStatement: Boolean(l.bankTransaction),
    bankTransactionId: l.bankTransaction ? String(l.bankTransaction) : null,
    createdBy: l.createdBy?.name ?? null,
    createdAt: (l.createdAt as Date).toISOString(),
    updatedAt: (l.updatedAt as Date).toISOString(),
  };
}

/* Loans & borrowings */

export type LoanSummary = {
  count: number;
  originalAmount: number;
  principalPaid: number;
  outstanding: number;
  interestPaid: number;
  overdue: number;
  overdueCount: number;
  /** Planned interest on instalments not covered yet, for loans with a full schedule. */
  plannedInterest: number;
  scheduledLoans: number;
};

export async function listLoans(params: ListParams, now: Date = new Date()) {
  await connectDB();
  const [docs, groups] = await Promise.all([
    Liability.find({ archivedAt: null, kind: { $ne: "other" } }).sort({ date: -1 }).lean(),
    loadLiabilityGroups(),
  ]);
  const all = docs.map((l) => toRow(l, groups, now));
  const filtered = filterLiabilities(all, params, now);
  const sorted = sortRows(filtered, params.sort, (r, key) => {
    const v = r[key as keyof LiabilityListRow];
    return typeof v === "number" || typeof v === "string" ? v : null;
  });
  // The planned interest card follows the same filters as the other figures.
  const shown = new Set(filtered.map((r) => r.id));
  let plannedInterest = 0;
  let scheduledLoans = 0;
  for (const l of docs) {
    if (!shown.has(String(l._id))) continue;
    const s = liabilityState(l, now);
    if (s.outstanding <= 0) continue;
    const plan = emiSchedule(
      { originalAmount: l.originalAmount, interestRate: l.interestRate ?? null, tenureMonths: l.tenureMonths ?? null, installment: l.installment ?? null, date: toDateInput(l.date) },
      s.principalPaid,
      now,
    );
    if (!plan) continue;
    scheduledLoans += 1;
    plannedInterest += plan.interestRemaining;
  }
  const summary: LoanSummary = {
    count: filtered.length,
    originalAmount: sum(filtered.map((r) => r.originalAmount)),
    principalPaid: sum(filtered.map((r) => r.principalPaid)),
    outstanding: sum(filtered.map((r) => r.outstanding)),
    interestPaid: sum(filtered.map((r) => r.interestPaid)),
    overdue: sum(filtered.filter((r) => r.status === "overdue").map((r) => r.outstanding)),
    overdueCount: filtered.filter((r) => r.status === "overdue").length,
    plannedInterest: round2(plannedInterest),
    scheduledLoans,
  };
  const usedGroups = new Set(all.map((r) => r.group));
  return {
    ...paginate(sorted, params),
    summary,
    totalLoans: all.length,
    lenders: [...new Set(all.map((r) => r.lender))].sort((a, b) => a.localeCompare(b)),
    groupFilter: groups.filter((g) => usedGroups.has(g.key)).map((g) => ({ value: g.key, label: g.label })),
  };
}

/* Current and non-current pages */

export async function groupSections(side: LiabilitySide, params: ListParams, now: Date = new Date()) {
  await connectDB();
  const [groups, sheet, docs] = await Promise.all([loadLiabilityGroups(), balanceSheet(now), Liability.find({ archivedAt: null }).sort({ date: -1 }).lean()]);
  const lines = side === "current_liabilities" ? sheet.liabilities.current : sheet.liabilities.nonCurrent;
  const rowsByGroup = new Map<string, LiabilityListRow[]>();
  for (const l of docs) {
    const r = toRow(l, groups, now);
    rowsByGroup.set(r.group, [...(rowsByGroup.get(r.group) ?? []), r]);
  }

  const top = groups.filter((g) => g.parent === side);
  const sections: GroupSection[] = [];
  for (const g of top) {
    const keys = descendantsOf(groups, g.key);
    const all = keys.flatMap((k) => rowsByGroup.get(k) ?? []);
    const line = lines.find((l) => l.key === g.key);
    // Archived subgroups only show while something is still in them.
    if (g.archived && !all.length && !line) continue;
    const computed = g.builtIn && builtInGroup(g.key)?.source === "computed";
    const entryKeys = keys.filter((k) => canHoldRecords(groups, k, "other"));
    const computedLines: GroupSection["computedLines"] = [];
    if (computed) {
      const source = COMPUTED_SOURCES[g.key];
      computedLines.push({ key: g.key, label: g.label, amount: line?.amount ?? 0, href: source?.href ?? null, sourceLabel: source?.label ?? null, note: source?.note ?? null });
    } else {
      // A computed part inside an entry group: GST payable under Taxes payable.
      for (const child of line?.children ?? []) {
        const source = COMPUTED_SOURCES[child.key];
        if (source) computedLines.push({ ...child, href: source.href, sourceLabel: source.label, note: source.note });
      }
    }
    const depthOf = (key: string) => (groups.find((x) => x.key === key)?.depth ?? g.depth) - g.depth;
    sections.push({
      key: g.key,
      label: g.label,
      description: g.description,
      builtIn: g.builtIn,
      computed,
      entry: entryKeys.length > 0,
      amount: line?.amount ?? 0,
      computedLines,
      groupKeys: entryKeys,
      subgroups: keys
        .filter((k) => k !== g.key)
        .map((k) => {
          const sub = groups.find((x) => x.key === k)!;
          const rows = rowsByGroup.get(k) ?? [];
          return { key: k, label: sub.label, depth: depthOf(k), outstanding: sum(rows.map((r) => r.outstanding)), count: rows.length };
        }),
      rows: filterLiabilities(all, params, now),
      totalCount: all.length,
      outstanding: sum(all.map((r) => r.outstanding)),
    });
  }
  const allRows = [...rowsByGroup.values()].flat().filter((r) => sections.some((s) => descendantsOf(groups, s.key).includes(r.group)));
  return {
    sections,
    total: side === "current_liabilities" ? sheet.liabilities.totalCurrent : sheet.liabilities.totalNonCurrent,
    recordsOutstanding: sum(allRows.map((r) => r.outstanding)),
    recordCount: allRows.length,
    filteredCount: sections.reduce((s, x) => s + x.rows.length, 0),
    overdue: sum(allRows.filter((r) => r.status === "overdue").map((r) => r.outstanding)),
    overdueCount: allRows.filter((r) => r.status === "overdue").length,
    lenders: [...new Set(allRows.map((r) => r.lender))].sort((a, b) => a.localeCompare(b)),
    asOf: sheet.asOf,
  };
}

/* Accounts payable */

/**
 * A salary bill names the person and shows their pay. Without "data.salaries" it is left out of
 * every list on the Liabilities pages; totals still count it, as the balance sheet does.
 */
const SALARY_CATEGORY = "salaries";
const salaryBillFilter = (seesSalaries: boolean) => (r: { category: string }) => seesSalaries || r.category !== SALARY_CATEGORY;

function vendorTotals(rows: { vendor: string; outstanding: number; status: string }[]) {
  const byVendor = new Map<string, { vendor: string; outstanding: number; bills: number; overdue: number }>();
  for (const r of rows) {
    const v = byVendor.get(r.vendor) ?? { vendor: r.vendor, outstanding: 0, bills: 0, overdue: 0 };
    v.outstanding = round2(v.outstanding + r.outstanding);
    v.bills += 1;
    if (r.status === "overdue") v.overdue = round2(v.overdue + r.outstanding);
    byVendor.set(r.vendor, v);
  }
  return [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding);
}

export async function payablesPage(params: ListParams, now: Date = new Date()) {
  await connectDB();
  const seesSalaries = await canSeeSalaries();
  const [summary, labelOfCategory] = await Promise.all([payablesSummary(now, { includeSalaries: seesSalaries }), getExpenseCategoryLabeler()]);
  const shown = summary.rows.filter(salaryBillFilter(seesSalaries));
  const byVendor = seesSalaries ? summary.byVendor : vendorTotals(shown);
  const projectIds = [...new Set(shown.map((r) => r.project).filter(Boolean))] as string[];
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } }, { name: 1 }).lean() : [];
  const projectName = new Map(projects.map((p) => [String(p._id), p.name]));

  const all: PayableListRow[] = shown.map((r) => ({
    id: r.id,
    number: r.number,
    vendor: r.vendor,
    category: r.category,
    categoryLabel: labelOfCategory(r.category),
    project: r.project ? { id: r.project, name: projectName.get(r.project) ?? "Project" } : null,
    date: r.date,
    dueDate: r.dueDate,
    amount: r.amount,
    paid: r.paid,
    outstanding: r.outstanding,
    status: r.status,
  }));
  const { vendor = [], status = [], due = [] } = params.filters;
  const q = params.q ? searchRegex(params.q) : null;
  const filtered = all.filter(
    (r) =>
      (!vendor.length || vendor.includes(r.vendor)) &&
      (!status.length || status.includes(r.status)) &&
      inDueBucket(r.dueDate, r.outstanding, due, now) &&
      inRange(r.dueDate, params.from, params.to) &&
      (!q || q.test(r.vendor) || q.test(r.number)),
  );
  const sorted = sortRows(filtered, params.sort, (r, key) => {
    const v = r[key as keyof PayableListRow];
    return typeof v === "number" || typeof v === "string" ? v : null;
  });

  const history = await billPayments(vendor, seesSalaries);
  return {
    ...paginate(sorted, params),
    summary: {
      total: summary.total,
      count: summary.count,
      overdue: summary.overdue,
      overdueCount: summary.overdueCount,
      dueSoon: summary.dueSoon,
      partial: summary.partial,
      unpaidCount: all.filter((r) => r.paid <= 0).length,
      filteredTotal: sum(filtered.map((r) => r.outstanding)),
      filteredCount: filtered.length,
    },
    byVendor,
    vendors: byVendor.map((v) => v.vendor),
    history,
  };
}

/** Payments recorded against bills, newest first. Older expenses paid on their own date have none to list. */
async function billPayments(vendors: string[], seesSalaries: boolean, limit = 40): Promise<BillPaymentRow[]> {
  const rows = await Expense.aggregate<{ _id: Types.ObjectId; number: string; vendor: string; payment: { _id?: Types.ObjectId; date: Date; amount: number; paymentMethod: PaymentMethod; reference?: string } }>([
    {
      $match: {
        countedAtPurchase: { $ne: true },
        "payments.0": { $exists: true },
        ...(vendors.length ? { vendor: { $in: vendors } } : {}),
        ...(seesSalaries ? {} : { category: { $ne: SALARY_CATEGORY } }),
      },
    },
    { $project: { number: 1, vendor: 1, payment: "$payments" } },
    { $unwind: "$payment" },
    { $sort: { "payment.date": -1, _id: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r, i) => ({
    key: r.payment._id ? String(r.payment._id) : `${r._id}:${i}`,
    expenseId: String(r._id),
    number: r.number,
    vendor: r.vendor,
    date: toDateInput(r.payment.date),
    amount: r.payment.amount,
    paymentMethod: r.payment.paymentMethod,
    reference: r.payment.reference ?? null,
  }));
}

/* Overview */

export async function liabilitiesDashboard(now: Date = new Date()) {
  await connectDB();
  const [overview, groups, scheduled, others] = await Promise.all([
    liabilitiesOverview(now),
    loadLiabilityGroups(),
    Liability.find({ archivedAt: null, kind: { $ne: "other" }, tenureMonths: { $gt: 0 }, installment: { $gt: 0 } }).lean(),
    Liability.find({ archivedAt: null, kind: "other" }, { _id: 1 }).lean(),
  ]);
  const otherIds = new Set(others.map((o) => String(o._id)));
  const today = toDateInput(now);
  const soon = toDateInput(addDays(now, 30));

  // Same rules as liabilitiesOverview, so these lists add up to its overdue and upcoming totals
  // (less any salary bills, which are left out of the lists without "data.salaries").
  // Loans open on the loans page; other obligations (TDS, salaries due) on their side's page.
  const loanItem = (l: (typeof overview.loans)[number], status: DueItem["status"]): DueItem => {
    const other = otherIds.has(l.id);
    const side = sideOf(groups, l.group) === "non_current_liabilities" ? "non-current" : "current";
    return {
      key: `loan:${l.id}`,
      kind: other ? "other" : "loan",
      label: l.name,
      sub: `${l.code} · ${l.lender}`,
      href: other ? `/finance/liabilities/${side}?view=${l.id}` : `/finance/liabilities/loans?view=${l.id}`,
      dueDate: l.dueDate,
      amount: l.outstanding,
      status,
    };
  };
  const billItem = (r: (typeof overview.payables.rows)[number], status: DueItem["status"]): DueItem => ({
    key: `bill:${r.id}`,
    kind: "bill",
    label: r.vendor,
    sub: `${r.number} · ${r.status === "partial" ? "part paid" : "bill"}`,
    href: `/finance/expenses?view=${r.id}`,
    dueDate: r.dueDate,
    amount: r.outstanding,
    status,
  });
  const byDue = (a: DueItem, b: DueItem) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  const bills = overview.payables.rows.filter(salaryBillFilter(await canSeeSalaries()));
  const overdue = [
    ...overview.loans.filter((l) => l.status === "overdue").map((l) => loanItem(l, "overdue")),
    ...bills.filter((r) => r.status === "overdue").map((r) => billItem(r, "overdue")),
  ].sort(byDue);
  const upcoming = [
    ...overview.loans.filter((l) => l.status !== "overdue" && l.dueDate && l.dueDate >= today && l.dueDate <= soon).map((l) => loanItem(l, "upcoming")),
    ...bills
      .filter((r) => r.status !== "overdue" && r.dueDate && r.dueDate >= today && r.dueDate <= soon)
      .map((r) => billItem(r, "upcoming")),
  ].sort(byDue);

  // Planned instalments from loan schedules: shown apart, since they are a plan, not an amount due on record.
  const instalments: { id: string; code: string; name: string; lender: string; date: string; amount: number; late: boolean }[] = [];
  for (const l of scheduled) {
    const s = liabilityState(l, now);
    if (s.outstanding <= 0) continue;
    const plan = emiSchedule(
      { originalAmount: l.originalAmount, interestRate: l.interestRate ?? null, tenureMonths: l.tenureMonths ?? null, installment: l.installment ?? null, date: toDateInput(l.date) },
      s.principalPaid,
      now,
    );
    for (const row of plan?.rows ?? []) {
      if (row.status === "covered" || row.dueDate > soon) continue;
      instalments.push({ id: String(l._id), code: l.code, name: l.name, lender: l.lender, date: row.dueDate, amount: row.installment, late: row.status === "due" });
    }
  }
  instalments.sort((a, b) => a.date.localeCompare(b.date));

  const statusCount = (status: LiabilityStatus) => overview.loans.filter((l) => l.status === status).length;
  return {
    total: overview.total,
    current: overview.current,
    nonCurrent: overview.nonCurrent,
    currentLines: overview.currentLines,
    nonCurrentLines: overview.nonCurrentLines,
    overdue: overview.overdue,
    overdueCount: overview.overdueCount,
    upcoming: overview.upcoming,
    overdueItems: overdue,
    upcomingItems: upcoming,
    instalments,
    openLoans: overview.loans.length,
    pendingLoans: statusCount("pending"),
    payablesTotal: overview.payables.total,
    payablesCount: overview.payables.count,
    groups,
  };
}
