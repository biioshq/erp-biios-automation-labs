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
  type FileDoc,
  ProjectMember,
  type ProjectDoc,
  type ProjectMemberDoc,
  type TaskDoc,
} from "@/server/models";
import { iso } from "@/server/serialize";
import { projectSpend, type ProjectSpend } from "@/server/services/metrics";
import { toFileDTO } from "@/features/files/server";
import { listExpenses } from "@/features/finance/expenses/queries";
import type { ExpenseRow } from "@/features/finance/expenses/types";
import { PROJECT_DOCUMENT_TYPES, PROJECT_STAGES, labelOf, type ProjectDocumentType, type ProjectStage, type ProjectStatus } from "@/lib/constants";
import { formatNumber, round2 } from "@/lib/format";
import { toDateInput } from "@/lib/dates";
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

const stageMap = () => Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, 0])) as Record<ProjectStage, number>;
const NO_LINKS: ProjectLinks = { expenses: 0, income: 0, allocations: 0, tasks: 0 };

/** Income, allocation and task counts per project (what stops a delete). */
async function linkedCounts(ids?: Types.ObjectId[]) {
  const pipeline: PipelineStage[] = [
    { $match: ids ? { project: { $in: ids } } : { project: { $ne: null } } },
    { $group: { _id: "$project", n: { $sum: 1 } } },
  ];
  const [income, allocations, tasks] = await Promise.all([
    Income.aggregate<{ _id: Types.ObjectId; n: number }>(pipeline),
    InventoryAllocation.aggregate<{ _id: Types.ObjectId; n: number }>(pipeline),
    Task.aggregate<{ _id: Types.ObjectId; n: number }>(pipeline),
  ]);
  const out = new Map<string, Omit<ProjectLinks, "expenses">>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { income: 0, allocations: 0, tasks: 0 });
    return out.get(id)!;
  };
  for (const r of income) get(String(r._id)).income = r.n;
  for (const r of allocations) get(String(r._id)).allocations = r.n;
  for (const r of tasks) get(String(r._id)).tasks = r.n;
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
export async function listProjects(params: ProjectListParams): Promise<{ rows: ProjectRow[]; summary: ProjectsSummary }> {
  await connectDB();
  const [docs, spend, links] = await Promise.all([Project.find().lean(), projectSpend(), linkedCounts()]);
  const all = docs.map((p) => toRow(p as ProjectDoc, spend.get(String(p._id)), links.get(String(p._id))));

  const q = params.q.trim().toLowerCase();
  const rows = all
    .filter((p) => (params.status.length ? params.status.includes(p.status) : true))
    .filter((p) => (q ? [p.name, p.code, p.client ?? ""].some((v) => v.toLowerCase().includes(q)) : true))
    .sort((a, b) => SORTERS[params.sort](a, b) || a.name.localeCompare(b.name));

  const totalBudget = round2(all.reduce((s, p) => s + p.budget, 0));
  const totalSpent = round2(all.reduce((s, p) => s + p.spent, 0));
  return {
    rows,
    summary: {
      count: all.length,
      activeCount: all.filter((p) => p.status === "active").length,
      totalBudget,
      totalSpent,
      remaining: round2(totalBudget - totalSpent),
    },
  };
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
  const [spend, links, held, openTasks, teamSize] = await Promise.all([
    projectSpend([id]),
    linkedCounts([oid]),
    InventoryAllocation.aggregate<{ value: number }>([
      { $match: { project: oid } },
      { $group: { _id: null, value: { $sum: { $multiply: ["$quantity", "$unitCost"] } } } },
    ]),
    Task.countDocuments(openFilter as QueryFilter<TaskDoc>),
    ProjectMember.countDocuments({ project: oid, endDate: null } as QueryFilter<ProjectMemberDoc>),
  ]);
  const creator = p.createdBy as unknown as { name?: string } | null;
  return {
    ...toRow(p as unknown as ProjectDoc, spend.get(id), links.get(id)),
    byStage: spend.get(id)?.byStage ?? stageMap(),
    inventoryValue: round2(held[0]?.value ?? 0),
    openTasks,
    teamSize,
    createdBy: creator?.name ?? null,
  };
}

/** Stage-wise planned vs actual spend for all seven stages. */
export function stageRows(project: Pick<ProjectDetail, "byStage" | "stageBudgets" | "spent">): StageRow[] {
  return PROJECT_STAGES.map((s) => {
    const planned = project.stageBudgets[s.value] ?? 0;
    const spent = project.byStage[s.value] ?? 0;
    return {
      stage: s.value,
      label: s.label,
      planned,
      spent,
      variance: planned > 0 ? round2(planned - spent) : null,
      share: project.spent > 0 ? spent / project.spent : 0,
    };
  });
}

/** This project's expenses, reusing the Finance expense query. */
export async function listProjectExpenses(projectId: string): Promise<ExpenseRow[]> {
  const data = await listExpenses({
    q: "",
    page: 1,
    pageSize: 1000,
    sort: { id: "date", desc: true },
    filters: { project: [projectId] },
    from: null,
    to: null,
  });
  return data.rows;
}

export async function getProjectInventory(projectId: string): Promise<{
  rows: InventoryUsedRow[];
  totals: { held: number; returned: number; value: number };
}> {
  await connectDB();
  const docs = await InventoryAllocation.find({ project: new Types.ObjectId(projectId) })
    .populate("item", "name sku unit")
    .sort({ assignedAt: -1, _id: -1 })
    .lean();
  const rows = docs.map((a): InventoryUsedRow => {
    const item = a.item as unknown as { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
    return {
      id: String(a._id),
      item: item?._id ? { id: String(item._id), name: item.name, sku: item.sku, unit: item.unit ?? "pcs" } : null,
      quantityHeld: a.quantity,
      quantityReturned: a.quantityReturned ?? 0,
      quantityAssigned: a.quantityAssigned,
      unitCost: a.unitCost,
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
  const [expenses, income, movements, tasks, files] = await Promise.all([
    // Inventory assignments show up as stock events below, not twice.
    Expense.find({ project: oid, source: "manual" }).sort({ date: -1 }).limit(limit).lean(),
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
  const [docs, expenses] = await Promise.all([
    FileModel.find(docFilter as QueryFilter<FileDoc>).populate("uploadedBy", "name").sort({ createdAt: -1 }).lean(),
    Expense.find({ project: oid, receipt: { $ne: null } }, { receipt: 1, number: 1, vendor: 1 }).sort({ date: -1 }).lean(),
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

