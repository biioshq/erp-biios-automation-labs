import "server-only";

import { Types, type PipelineStage, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import {
  Expense,
  FileModel,
  Income,
  InventoryAllocation,
  InventoryMovement,
  Project,
  Task,
  User,
  type FileDoc,
  ProjectMember,
  RecurringExpense,
  type ProjectDoc,
  type ProjectMemberDoc,
  type TaskDoc,
} from "@/server/models";
import { iso } from "@/server/serialize";
import { salaryScope } from "@/server/auth/session";
import { projectSpend, type ProjectSpend } from "@/server/services/metrics";
import { toFileDTO } from "@/features/files/server";
import { listExpenses } from "@/features/finance/expenses/queries";
import type { ExpenseRow } from "@/features/finance/expenses/types";
import { PROJECT_DOCUMENT_TYPES, PROJECT_STAGES, labelOf, type ProjectDocumentType, type ProjectStage, type ProjectStatus } from "@/lib/constants";
import { formatNumber, round2 } from "@/lib/format";
import { toDateInput } from "@/lib/dates";
import { roundQty } from "@/features/inventory/ledger/stock-cost";
import type { ProjectSort } from "./schemas";
import type {
  ExpenseReceipt,
  InventoryUsedRow,
  ProjectDetail,
  ProjectDocument,
  ProjectLinks,
  ProjectRow,
  ProjectsSummary,
  StageRow,
  TimelineEvent,
} from "./types";
import { currentMembership } from "@/features/employees/membership";
import { emptyPayables, originalBudgetOf, projectOutlook, sumBy, type ProjectFinance } from "./finance";
import { projectFinances } from "./finance-queries";
import type { BudgetChange, ProjectFinanceRow } from "./types";

const stageMap = () => Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, 0])) as Record<ProjectStage, number>;
const NO_LINKS: ProjectLinks = { expenses: 0, income: 0, allocations: 0, tasks: 0, schedules: 0 };

/** Income, allocation, task and live recurring schedule counts per project (what stops a delete). */
async function linkedCounts(ids?: Types.ObjectId[]) {
  const pipeline: PipelineStage[] = [
    { $match: ids ? { project: { $in: ids } } : { project: { $ne: null } } },
    { $group: { _id: "$project", n: { $sum: 1 } } },
  ];
  // An active or paused schedule would keep posting to the project after it is gone.
  const schedulePipeline: PipelineStage[] = [{ $match: { status: { $ne: "ended" } } }, ...pipeline];
  const [income, allocations, tasks, schedules] = await Promise.all([
    Income.aggregate<{ _id: Types.ObjectId; n: number }>(pipeline),
    InventoryAllocation.aggregate<{ _id: Types.ObjectId; n: number }>(pipeline),
    Task.aggregate<{ _id: Types.ObjectId; n: number }>(pipeline),
    RecurringExpense.aggregate<{ _id: Types.ObjectId; n: number }>(schedulePipeline),
  ]);
  const out = new Map<string, Omit<ProjectLinks, "expenses">>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { income: 0, allocations: 0, tasks: 0, schedules: 0 });
    return out.get(id)!;
  };
  for (const r of income) get(String(r._id)).income = r.n;
  for (const r of allocations) get(String(r._id)).allocations = r.n;
  for (const r of tasks) get(String(r._id)).tasks = r.n;
  for (const r of schedules) get(String(r._id)).schedules = r.n;
  return out;
}

function toRow(p: ProjectDoc, spend: ProjectSpend | undefined, links: Omit<ProjectLinks, "expenses"> | undefined): ProjectRow {
  const spent = spend?.spent ?? 0;
  const stored = (p.stageBudgets ?? {}) as unknown as Partial<Record<ProjectStage, number>>;
  const stageBudgets = stageMap();
  for (const s of PROJECT_STAGES) stageBudgets[s.value] = stored[s.value] ?? 0;
  return {
    id: String(p._id),
    code: p.code,
    name: p.name,
    client: p.client ?? null,
    description: p.description ?? null,
    status: p.status as ProjectStatus,
    color: p.color ?? "#4a82cc",
    budget: p.budget,
    originalBudget: originalBudgetOf(p.budget, p.budgetHistory),
    contractValue: typeof p.contractValue === "number" ? p.contractValue : null,
    stageBudgets,
    startDate: iso(p.startDate),
    endDate: iso(p.endDate),
    spent,
    remaining: round2(p.budget - spent),
    usage: p.budget > 0 ? spent / p.budget : 0,
    income: spend?.income ?? 0,
    expenseCount: spend?.expenseCount ?? 0,
    links: { ...NO_LINKS, ...links, expenses: spend?.expenseCount ?? 0 },
    createdAt: iso(p.createdAt as Date)!,
  };
}

/** Adds revenue, spend by type and the forecast figures to a row. */
export function withFinance(row: ProjectRow, finance: ProjectFinance | undefined): ProjectFinanceRow {
  const f: ProjectFinance = finance ?? {
    projectId: row.id,
    spent: row.spent,
    byType: { material: 0, labour: 0, equipment: 0, transport: 0, other: row.spent },
    byStage: stageMap(),
    expenseCount: row.expenseCount,
    revenue: { invoiced: 0, invoiceCount: 0, receivedOnInvoices: 0, receivedDirect: 0, received: 0, revenue: 0, outstanding: 0, overdue: 0 },
    payables: emptyPayables(PROJECT_STAGES.map((s) => s.value)),
    salariesHidden: false,
  };
  return {
    ...row,
    finance: f,
    outlook: projectOutlook({
      status: row.status,
      budget: row.budget,
      originalBudget: row.originalBudget,
      contractValue: row.contractValue,
      spent: row.spent,
      revenue: f.revenue.revenue,
    }),
  };
}

const SORTERS: Record<ProjectSort, (a: ProjectRow, b: ProjectRow) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name),
  budget: (a, b) => b.budget - a.budget,
  spent: (a, b) => b.spent - a.spent,
  end: (a, b) => (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999"),
};

export type ProjectListParams = { q: string; status: string[]; sort: ProjectSort };

/**
 * Every project with live spend. Search, status filter and sort run in memory
 * (sorting by spend needs the aggregated numbers), and the KPI summary covers all projects.
 */
export async function listProjects(params: ProjectListParams): Promise<{ rows: ProjectFinanceRow[]; summary: ProjectsSummary }> {
  await connectDB();
  const [docs, spend, links, finances] = await Promise.all([Project.find().lean(), projectSpend(), linkedCounts(), projectFinances()]);
  const all = docs.map((p) => withFinance(toRow(p as ProjectDoc, spend.get(String(p._id)), links.get(String(p._id))), finances.get(String(p._id))));

  const q = params.q.trim().toLowerCase();
  const rows = all
    .filter((p) => (params.status.length ? params.status.includes(p.status) : true))
    .filter((p) => (q ? [p.name, p.code, p.client ?? ""].some((v) => v.toLowerCase().includes(q)) : true))
    .sort((a, b) => SORTERS[params.sort](a, b) || a.name.localeCompare(b.name));

  const totalBudget = round2(all.reduce((s, p) => s + p.budget, 0));
  const totalSpent = round2(all.reduce((s, p) => s + p.spent, 0));
  const totalPaid = sumBy(all, (p) => p.finance.payables.paid);
  return {
    rows,
    summary: {
      count: all.length,
      activeCount: all.filter((p) => p.status === "active").length,
      totalBudget,
      totalSpent,
      remaining: round2(totalBudget - totalSpent),
      totalContractValue: sumBy(all, (p) => p.contractValue ?? 0),
      withContractValue: all.filter((p) => p.contractValue !== null).length,
      totalRevenue: sumBy(all, (p) => p.finance.revenue.revenue),
      totalReceived: sumBy(all, (p) => p.finance.revenue.received),
      totalOutstanding: sumBy(all, (p) => p.finance.revenue.outstanding),
      totalPaid,
      totalPayables: round2(totalSpent - totalPaid),
      payablesOverdue: sumBy(all, (p) => p.finance.payables.overdue),
    },
  };
}

/** Every project with its finances, optionally only some statuses (profitability and budget pages). */
export async function listProjectFinances(status: string[] = []): Promise<{ rows: ProjectFinanceRow[]; total: number }> {
  await connectDB();
  const [docs, finances] = await Promise.all([Project.find().lean(), projectFinances()]);
  const all = docs.map((p) => {
    const f = finances.get(String(p._id));
    const spend = f ? { projectId: f.projectId, spent: f.spent, byStage: f.byStage, expenseCount: f.expenseCount, income: 0, salariesHidden: f.salariesHidden } : undefined;
    return withFinance(toRow(p as ProjectDoc, spend, undefined), f);
  });
  const rows = all
    .filter((p) => (status.length ? status.includes(p.status) : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows, total: all.length };
}

/** Known client names for the form's suggestions. */
export async function getClientNames(): Promise<string[]> {
  await connectDB();
  const names = (await Project.distinct("client")) as (string | null)[];
  return names.filter((n): n is string => Boolean(n)).sort((a, b) => a.localeCompare(b));
}

/** One project as a row (for the edit form deep link). */
export async function getProjectRow(id: string): Promise<ProjectRow | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const p = await Project.findById(id).lean();
  if (!p) return null;
  const [spend, links] = await Promise.all([projectSpend([id]), linkedCounts([p._id])]);
  return toRow(p as ProjectDoc, spend.get(id), links.get(id));
}

export async function getProjectDetail(id: string): Promise<ProjectDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const oid = new Types.ObjectId(id);
  const p = await Project.findById(oid).populate("createdBy", "name").lean();
  if (!p) return null;
  const openFilter = { project: oid, status: { $nin: ["completed", "cancelled"] } } as Record<string, unknown>;
  const [spend, links, held, openTasks, teamSize, finances, changers] = await Promise.all([
    projectSpend([id]),
    linkedCounts([oid]),
    InventoryAllocation.find({ project: oid }, { quantity: 1, quantityWasted: 1, unitCost: 1 }).lean(),
    Task.countDocuments(openFilter as QueryFilter<TaskDoc>),
    ProjectMember.countDocuments({ project: oid, ...currentMembership() } as QueryFilter<ProjectMemberDoc>),
    projectFinances([id]),
    budgetChangers(p.budgetHistory),
  ]);
  const creator = p.createdBy as unknown as { name?: string } | null;
  return {
    ...withFinance(toRow(p as unknown as ProjectDoc, spend.get(id), links.get(id)), finances.get(id)),
    budgetHistory: (p.budgetHistory ?? []).map(
      (h): BudgetChange => ({
        budget: h.budget,
        changedAt: iso(h.changedAt)!,
        changedBy: h.changedBy ? (changers.get(String(h.changedBy)) ?? null) : null,
        note: h.note ?? null,
      }),
    ),
    byStage: spend.get(id)?.byStage ?? stageMap(),
    // Stock the project still holds: units wasted there are used up, so they are left out (their
    // cost stays charged to the project, on the Inventory tab). Rounded per allocation, as the
    // generated expenses are, so with no wastage it matches the Inventory tab's total to the paisa.
    inventoryValue: round2(held.reduce((s, a) => s + round2(Math.max(0, a.quantity - (a.quantityWasted ?? 0)) * a.unitCost), 0)),
    openTasks,
    teamSize,
    createdBy: creator?.name ?? null,
  };
}

/** Names of the people who changed a budget, by user id. */
async function budgetChangers(history: { changedBy?: Types.ObjectId | null }[] | null | undefined): Promise<Map<string, string>> {
  const ids = [...new Set((history ?? []).map((h) => (h.changedBy ? String(h.changedBy) : null)).filter((v): v is string => Boolean(v)))];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids.map((u) => new Types.ObjectId(u)) } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), (u as { name?: string }).name ?? ""]));
}

/** Stage-wise planned vs actual spend for all seven stages. */
export function stageRows(project: Pick<ProjectDetail, "byStage" | "stageBudgets" | "spent"> & { finance?: Pick<ProjectDetail["finance"], "payables"> }): StageRow[] {
  return PROJECT_STAGES.map((s) => {
    const planned = project.stageBudgets[s.value] ?? 0;
    const spent = project.byStage[s.value] ?? 0;
    const split = project.finance?.payables.byStage[s.value];
    // Paid and outstanding come from the shared split (projectPaymentSplit); without it all of the spend reads as paid.
    const paid = split ? split.paid : spent;
    return {
      stage: s.value,
      label: s.label,
      planned,
      spent,
      paid,
      outstanding: round2(spent - paid),
      variance: planned > 0 ? round2(planned - spent) : null,
      share: project.spent > 0 ? spent / project.spent : 0,
    };
  });
}

/** All of this project's expenses (the tab filters and totals them in the browser), reusing the Finance expense query. */
export async function listProjectExpenses(projectId: string): Promise<ExpenseRow[]> {
  const query = (pageSize: number) =>
    listExpenses({
      q: "",
      page: 1,
      pageSize,
      sort: { id: "date", desc: true },
      filters: { project: [projectId] },
      from: null,
      to: null,
    });
  const data = await query(1000);
  // A large project would otherwise show a capped count and total with no sign that rows are missing.
  return data.total > data.rows.length ? (await query(data.total)).rows : data.rows;
}

/**
 * One assignment on the project's Inventory tab. Units wasted on the project stay in
 * `quantityHeld` and in `totalCost` (the project keeps that cost), but they can no longer be
 * returned: `returnable` is what a return can still take.
 */
export type ProjectInventoryRow = InventoryUsedRow & {
  /** Units wasted on the project from this assignment. */
  quantityWasted: number;
  /** quantityHeld less quantityWasted, never below zero. */
  returnable: number;
};

export async function getProjectInventory(projectId: string): Promise<{
  rows: ProjectInventoryRow[];
  totals: { held: number; returned: number; wasted: number; returnable: number; value: number };
}> {
  await connectDB();
  const docs = await InventoryAllocation.find({ project: new Types.ObjectId(projectId) })
    .populate("item", "name sku unit")
    .sort({ assignedAt: -1, _id: -1 })
    .lean();
  const rows = docs.map((a): ProjectInventoryRow => {
    const item = a.item as unknown as { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
    const quantityWasted = a.quantityWasted ?? 0;
    return {
      id: String(a._id),
      item: item?._id ? { id: String(item._id), name: item.name, sku: item.sku, unit: item.unit ?? "pcs" } : null,
      quantityHeld: a.quantity,
      quantityReturned: a.quantityReturned ?? 0,
      quantityAssigned: a.quantityAssigned,
      quantityWasted,
      returnable: roundQty(Math.max(0, a.quantity - quantityWasted)),
      unitCost: a.unitCost,
      // Wasted units stay charged to the project, so the cost is on the full quantity held.
      totalCost: round2(a.quantity * a.unitCost),
      assignedAt: iso(a.assignedAt)!,
      stage: a.stage as ProjectStage,
    };
  });
  return {
    rows,
    totals: {
      held: rows.reduce((s, r) => s + r.quantityHeld, 0),
      returned: rows.reduce((s, r) => s + r.quantityReturned, 0),
      wasted: roundQty(rows.reduce((s, r) => s + r.quantityWasted, 0)),
      returnable: roundQty(rows.reduce((s, r) => s + r.returnable, 0)),
      value: round2(rows.reduce((s, r) => s + r.totalCost, 0)),
    },
  };
}

/** Everything that happened on the project, newest first, including start and end milestones. */
export async function getProjectTimeline(project: Pick<ProjectDetail, "id" | "name" | "createdAt" | "startDate" | "endDate">, limit = 150): Promise<TimelineEvent[]> {
  await connectDB();
  const oid = new Types.ObjectId(project.id);
  const taskFilter = { project: oid } as Record<string, unknown>;
  const fileFilter = { project: oid, kind: "document" } as Record<string, unknown>;
  // Members never see individual salary rows (payee and amount).
  const scope = await salaryScope();
  const [expenses, income, movements, tasks, files] = await Promise.all([
    // Inventory assignments show up as stock events below, not twice. Recurring postings are listed.
    Expense.find({ project: oid, source: { $ne: "inventory_assignment" }, ...scope }).sort({ date: -1 }).limit(limit).lean(),
    Income.find({ project: oid }).sort({ date: -1 }).limit(limit).lean(),
    InventoryMovement.find({ project: oid, type: { $in: ["assign", "return"] } })
      .populate("item", "name sku")
      .sort({ date: -1 })
      .limit(limit)
      .lean(),
    Task.find(taskFilter as QueryFilter<TaskDoc>).sort({ createdAt: -1 }).limit(limit).lean(),
    FileModel.find(fileFilter as QueryFilter<FileDoc>).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);

  const events: TimelineEvent[] = [
    { id: "created", kind: "created", at: project.createdAt, title: "Project created", detail: project.name, amount: null, href: null },
  ];
  for (const e of expenses) {
    events.push({
      id: `expense-${e._id}`,
      kind: "expense",
      at: iso(e.date)!,
      title: `Expense added: ${e.vendor}`,
      detail: [e.number, e.stage ? labelOf(PROJECT_STAGES, e.stage as ProjectStage) : null].filter(Boolean).join(" · "),
      amount: e.amount,
      href: `/finance/expenses?view=${e._id}`,
    });
  }
  for (const i of income) {
    events.push({
      id: `income-${i._id}`,
      kind: "income",
      at: iso(i.date)!,
      title: `Income received from ${i.client}`,
      detail: i.number,
      amount: i.amount,
      href: `/finance/income?view=${i._id}`,
    });
  }
  for (const m of movements) {
    const item = m.item as unknown as { _id: Types.ObjectId; name: string; sku: string } | null;
    const assigned = m.type === "assign";
    events.push({
      id: `movement-${m._id}`,
      kind: assigned ? "assigned" : "returned",
      at: iso(m.date)!,
      title: `${formatNumber(m.quantity)} × ${item?.name ?? "an item"} ${assigned ? "assigned" : "returned"}`,
      detail: [item?.sku, m.stage ? labelOf(PROJECT_STAGES, m.stage as ProjectStage) : null].filter(Boolean).join(" · ") || null,
      amount: m.totalCost || null,
      href: item?._id ? `/inventory/items/${item._id}` : null,
    });
  }
  for (const t of tasks) {
    events.push({
      id: `task-${t._id}`,
      kind: "task_created",
      at: iso(t.createdAt as Date)!,
      title: `Task created: ${t.title}`,
      detail: t.number,
      amount: null,
      href: `/tasks/all?task=${t._id}`,
    });
    if (t.completedAt) {
      events.push({
        id: `task-done-${t._id}`,
        kind: "task_completed",
        at: iso(t.completedAt)!,
        title: `Task completed: ${t.title}`,
        detail: t.number,
        amount: null,
        href: `/tasks/all?task=${t._id}`,
      });
    }
  }
  for (const f of files) {
    events.push({
      id: `file-${f._id}`,
      kind: "document",
      at: iso(f.createdAt as Date)!,
      title: `Document uploaded: ${f.name}`,
      detail: f.documentType ? labelOf(PROJECT_DOCUMENT_TYPES, f.documentType as ProjectDocumentType) : null,
      amount: null,
      href: null,
    });
  }
  if (project.startDate) {
    events.push({ id: "start", kind: "start", at: project.startDate, title: "Planned start", detail: null, amount: null, href: null });
  }
  if (project.endDate) {
    events.push({ id: "end", kind: "end", at: project.endDate, title: "Planned end", detail: null, amount: null, href: null });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** Timeline events grouped by IST calendar day, newest day first. */
export function groupByDay(events: TimelineEvent[]): { day: string; events: TimelineEvent[] }[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const day = toDateInput(e.at);
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }
  return [...groups.entries()].map(([day, list]) => ({ day, events: list }));
}

const toDoc = (f: unknown) => toFileDTO(f as Parameters<typeof toFileDTO>[0]);

export async function getProjectDocuments(projectId: string): Promise<{ documents: ProjectDocument[]; receipts: ExpenseReceipt[] }> {
  await connectDB();
  const oid = new Types.ObjectId(projectId);
  const docFilter = { project: oid, kind: "document" } as Record<string, unknown>;
  // Salary receipts are payslips: members never see them.
  const scope = await salaryScope();
  const [docs, expenses] = await Promise.all([
    FileModel.find(docFilter as QueryFilter<FileDoc>).populate("uploadedBy", "name").sort({ createdAt: -1 }).lean(),
    Expense.find({ project: oid, receipt: { $ne: null }, ...scope }, { receipt: 1, number: 1, vendor: 1 }).sort({ date: -1 }).lean(),
  ]);
  const receiptFilter = { _id: { $in: expenses.map((e) => e.receipt) } } as Record<string, unknown>;
  const receiptFiles = expenses.length ? await FileModel.find(receiptFilter as QueryFilter<FileDoc>).populate("uploadedBy", "name").lean() : [];
  const byId = new Map(receiptFiles.map((f) => [String(f._id), f]));
  const receipts: ExpenseReceipt[] = [];
  for (const e of expenses) {
    const file = byId.get(String(e.receipt));
    if (file) receipts.push({ file: toDoc(file), expense: { id: String(e._id), number: e.number, vendor: e.vendor } });
  }
  return { documents: docs.map(toDoc), receipts };
}

