import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, Expense, FixedAsset, InventoryAllocation, InventoryItem, InventoryMovement, Project, ProjectMember } from "@/server/models";
import { DEFAULT_WINDOW_DAYS, coverage, usageByItem } from "@/server/analytics/core";
import { cashBalances } from "@/server/accounting/statements";
import { COMPANY_EXPENSES, projectSpend } from "@/server/services/metrics";
import { roundQty } from "@/server/services/inventory-ledger";
import { loadExpenseCategories } from "@/server/expense-categories";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { expenseCategoryLabel } from "@/lib/expense-categories";
import { addDays, endOfDayIST, financialYearIST, fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { PROJECT_STAGES, type AssetCondition, type ProjectStage } from "@/lib/constants";
import { round2 } from "@/lib/format";
import { searchRegex } from "@/lib/list-params";
import type { ScenarioSpec } from "../schemas";
import type { ScenarioResults } from "../types";
import type { AllocationFact, CashFact, ComputeContext, EmployeeFact, EquipmentFact, ItemFact, MembershipFact, ProjectFact } from "../compute/facts";
import { computeDemand } from "../compute/demand";
import { computeSupplyDelay } from "../compute/supply-delay";
import { computeNewProject } from "../compute/new-project";
import { computePrice } from "../compute/price";
import { computeBudget } from "../compute/budget";
import { headOfCategory } from "../compute/budget-heads";
import { computeManpower } from "../compute/manpower";
import { computeEquipment } from "../compute/equipment";

/**
 * Loads the recorded data a scenario needs and runs its calculation. Read-only: nothing here writes
 * to any collection. Figures come from the shared engine (project spend from metrics, rates of use
 * and stockout dates from the analytics core, cash from the accounting statements).
 */

export type Viewer = { admin: boolean };

const oid = (id: string) => new Types.ObjectId(id);
const validIds = (ids: string[]) => [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));

export async function loadItems(ids: string[], asOf: Date): Promise<Map<string, ItemFact>> {
  const list = validIds(ids);
  if (!list.length) return new Map();
  const [items, usage] = await Promise.all([
    InventoryItem.find({ _id: { $in: list.map(oid) }, archivedAt: null }, { name: 1, sku: 1, unit: 1, available: 1, minStock: 1, leadTimeDays: 1, unitPrice: 1, lastPurchasePrice: 1, vendor: 1 }).lean(),
    usageByItem(DEFAULT_WINDOW_DAYS, asOf, list),
  ]);
  return new Map(
    items.map((i) => {
      const id = String(i._id);
      return [
        id,
        {
          id,
          name: i.name,
          sku: i.sku,
          unit: i.unit ?? "pcs",
          available: roundQty(i.available ?? 0),
          minStock: i.minStock ?? 0,
          leadTimeDays: typeof i.leadTimeDays === "number" ? i.leadTimeDays : null,
          averageCost: i.unitPrice ?? 0,
          lastPurchasePrice: typeof i.lastPurchasePrice === "number" ? i.lastPurchasePrice : null,
          perDay: usage.get(id)?.perDay ?? null,
          windowDays: DEFAULT_WINDOW_DAYS,
          vendor: i.vendor ?? null,
        },
      ];
    }),
  );
}

/** Open allocations of the given materials, on every project. */
export async function loadAllocations(itemIds: string[]): Promise<AllocationFact[]> {
  const list = validIds(itemIds);
  if (!list.length) return [];
  const rows = await InventoryAllocation.find({ item: { $in: list.map(oid) }, quantity: { $gt: 0 } }, { project: 1, item: 1, quantity: 1, quantityWasted: 1, unitCost: 1, assignedAt: 1 }).lean();
  return rows.map((a) => ({
    projectId: String(a.project),
    itemId: String(a.item),
    quantity: roundQty(a.quantity),
    // Stock in use: units held less units wasted on the project (the inventory wastage rule).
    inUse: roundQty(Math.max(0, a.quantity - (a.quantityWasted ?? 0))),
    unitCost: a.unitCost,
    assignedAt: toDateInput(a.assignedAt),
  }));
}

/** Projects with their spend; all projects when no ids are given. */
export async function loadProjects(ids: string[] | null, viewer: Viewer): Promise<ProjectFact[]> {
  const list = ids ? validIds(ids) : null;
  if (list && !list.length) return [];
  const docs = await Project.find(list ? { _id: { $in: list.map(oid) } } : {}, { name: 1, code: 1, status: 1, color: 1, budget: 1, stageBudgets: 1, startDate: 1, endDate: 1 })
    .sort({ name: 1 })
    .lean();
  const spend = await projectSpend(
    docs.map((d) => d._id),
    { includeSalaries: viewer.admin },
  );
  return docs.map((p) => {
    const s = spend.get(String(p._id));
    const stageBudgets = Object.fromEntries(PROJECT_STAGES.map((st) => [st.value, (p.stageBudgets as Record<string, number> | undefined)?.[st.value] ?? 0])) as Record<ProjectStage, number>;
    return {
      id: String(p._id),
      name: p.name,
      code: p.code,
      status: p.status,
      color: p.color ?? "#4a82cc",
      budget: p.budget ?? 0,
      spent: s?.spent ?? 0,
      stageBudgets,
      stageSpent: s?.byStage ?? (Object.fromEntries(PROJECT_STAGES.map((st) => [st.value, 0])) as Record<ProjectStage, number>),
      startDate: p.startDate ? toDateInput(p.startDate) : null,
      endDate: p.endDate ? toDateInput(p.endDate) : null,
    };
  });
}

/**
 * Active employees and their current memberships on projects that are not completed or cancelled.
 * A membership is current with no end date or an end date after today, the same rule as the team
 * pages (employees/membership.ts currentMembership): an end date set ahead of time still counts.
 */
export async function loadPeople(viewer: Viewer, asOf: Date = new Date()): Promise<{ employees: EmployeeFact[]; memberships: MembershipFact[] }> {
  const people = await Employee.find({ status: "active" }, { name: 1, department: 1, designation: 1, skills: 1, monthlySalary: 1 }).lean();
  const ids = people.map((p) => p._id);
  const current = { $or: [{ endDate: null }, { endDate: { $gt: startOfDayIST(asOf) } }] };
  const [members, closed] = await Promise.all([
    ProjectMember.find({ employee: { $in: ids }, ...current }, { project: 1, employee: 1, role: 1, allocation: 1 }).lean(),
    Project.find({ status: { $in: ["completed", "cancelled"] } }, { _id: 1 }).lean(),
  ]);
  const done = new Set(closed.map((p) => String(p._id)));
  return {
    employees: people.map((p) => ({
      id: String(p._id),
      name: p.name,
      department: p.department ?? "engineering",
      designation: p.designation ?? null,
      skills: p.skills ?? [],
      // Pay is admin-only: members never receive it, not even inside a calculation.
      monthlySalary: viewer.admin ? (p.monthlySalary ?? 0) : null,
    })),
    memberships: members
      .filter((m) => !done.has(String(m.project)))
      .map((m) => ({ projectId: String(m.project), employeeId: String(m.employee), role: m.role ?? "Team member", allocation: m.allocation ?? 100 })),
  };
}

const EQUIPMENT_GROUPS = ["plant_machinery", "computers_electronics"];
const GONE: AssetCondition[] = ["disposed", "lost"];

/** Equipment in the fixed asset register: marked as equipment, or in plant and machinery or computers (subgroups included). */
export async function loadEquipment(filter: { ids?: string[]; name?: string } = {}): Promise<EquipmentFact[]> {
  const groups = await loadFinanceGroups("asset");
  const keys = EQUIPMENT_GROUPS.flatMap((g) => descendantsOf(groups, g));
  const query: Record<string, unknown> = {
    archivedAt: null,
    disposal: { $exists: false },
    condition: { $nin: GONE },
    $or: [{ isEquipment: true }, { group: { $in: keys } }],
  };
  if (filter.ids) query._id = { $in: validIds(filter.ids).map(oid) };
  if (filter.name) query.name = searchRegex(filter.name);
  const assets = await FixedAsset.find(query, { code: 1, name: 1, quantity: 1, condition: 1, project: 1, projectUntil: 1 })
    .populate<{ project: { _id: Types.ObjectId; name: string } | null }>("project", "name")
    .sort({ name: 1 })
    .lean();
  return assets.map((a) => ({
    id: String(a._id),
    code: a.code,
    name: a.name,
    quantity: a.quantity ?? 1,
    condition: (a.condition ?? "good") as AssetCondition,
    projectId: a.project?._id ? String(a.project._id) : null,
    projectName: a.project?.name ?? null,
    projectUntil: a.projectUntil ? toDateInput(a.projectUntil) : null,
  }));
}

/** Cash and bank balances from the accounting engine. Admins only. */
export async function loadCash(): Promise<CashFact> {
  const rows = await cashBalances();
  const accounts = rows.filter((r) => !r.archived || Math.abs(r.balance) >= 0.005).map((r) => ({ name: r.name, balance: r.balance }));
  return { total: round2(accounts.reduce((s, a) => s + a.balance, 0)), accounts };
}

async function demandFacts(spec: Extract<ScenarioSpec, { type: "demand" }>, viewer: Viewer, asOf: Date) {
  const itemIds = spec.inputs.materials.map((m) => m.itemId);
  const [items, allocations, projects] = await Promise.all([loadItems(itemIds, asOf), loadAllocations(itemIds), loadProjects(spec.inputs.projectIds, viewer)]);
  return { items, allocations, projects };
}

async function supplyDelayFacts(spec: Extract<ScenarioSpec, { type: "supply_delay" }>, viewer: Viewer, asOf: Date) {
  const items = await loadItems([spec.inputs.itemId], asOf);
  const item = items.get(spec.inputs.itemId);
  if (!item) return null;
  const from = startOfDayIST(addDays(asOf, -DEFAULT_WINDOW_DAYS + 1));
  const used = await InventoryMovement.aggregate<{ _id: Types.ObjectId; qty: number; returned: number; last: Date }>([
    { $match: { item: oid(item.id), type: { $in: ["assign", "return"] }, project: { $ne: null }, date: { $gte: from, $lte: asOf } } },
    {
      $group: {
        _id: "$project",
        qty: { $sum: { $cond: [{ $eq: ["$type", "assign"] }, "$quantity", 0] } },
        returned: { $sum: { $cond: [{ $eq: ["$type", "return"] }, "$quantity", 0] } },
        last: { $max: { $cond: [{ $eq: ["$type", "assign"] }, "$date", null] } },
      },
    },
  ]);
  const usedBy = new Map(used.filter((u) => u.qty > 0).map((u) => [String(u._id), u]));
  const ids = [...new Set([...usedBy.keys(), ...spec.inputs.projectIds])];
  const projects = await loadProjects(ids, viewer);
  const cov = coverage(item.available, item.perDay, item.leadTimeDays, asOf);
  return {
    item,
    coverage: { daysOfCover: cov.daysOfCover, stockoutDate: cov.stockoutDate },
    projects: projects.map((p) => {
      const u = usedBy.get(p.id);
      return { ...p, usedInWindow: u ? roundQty(Math.max(0, u.qty - u.returned)) : 0, lastIssued: u?.last ? toDateInput(u.last) : null, picked: spec.inputs.projectIds.includes(p.id) };
    }),
  };
}

async function newProjectFacts(spec: Extract<ScenarioSpec, { type: "new_project" }>, viewer: Viewer, asOf: Date) {
  const itemIds = spec.inputs.materials.map((m) => m.itemId);
  const assetIds = spec.inputs.equipment.flatMap((e) => (e.assetId ? [e.assetId] : []));
  const [items, allocations, equipment, people, projects, cash] = await Promise.all([
    loadItems(itemIds, asOf),
    loadAllocations(itemIds),
    assetIds.length ? loadEquipment({ ids: assetIds }) : Promise.resolve([]),
    loadPeople(viewer, asOf),
    loadProjects(null, viewer),
    viewer.admin ? loadCash() : Promise.resolve(null),
  ]);
  return { items, allocations, equipment: new Map(equipment.map((e) => [e.id, e])), ...people, projects, cash };
}

async function priceFacts(spec: Extract<ScenarioSpec, { type: "price" }>, viewer: Viewer, asOf: Date) {
  const items = await loadItems([spec.inputs.itemId], asOf);
  const item = items.get(spec.inputs.itemId);
  if (!item) return null;
  const fy = financialYearIST(asOf);
  const [allocations, projects, fyRows, purchases] = await Promise.all([
    loadAllocations([item.id]),
    loadProjects(spec.inputs.projectIds, viewer),
    InventoryMovement.aggregate<{ _id: boolean; total: number; qty: number }>([
      { $match: { type: "purchase", date: { $gte: fy.start, $lte: fy.end } } },
      { $group: { _id: { $eq: ["$item", oid(item.id)] }, total: { $sum: "$totalCost" }, qty: { $sum: "$quantity" } } },
    ]),
    InventoryMovement.find({ item: oid(item.id), type: "purchase" }, { date: 1, quantity: 1, unitCost: 1, vendor: 1 }).sort({ date: -1, _id: -1 }).limit(6).lean(),
  ]);
  const mine = fyRows.find((r) => r._id === true);
  return {
    item,
    allocations,
    projects,
    procurement: { label: fy.label, total: round2(fyRows.reduce((s, r) => s + r.total, 0)), itemQty: roundQty(mine?.qty ?? 0), itemTotal: round2(mine?.total ?? 0) },
    purchases: purchases.map((p) => ({ date: toDateInput(p.date), qty: roundQty(p.quantity), unitCost: p.unitCost ?? 0, vendor: p.vendor ?? null })),
  };
}

async function budgetFacts(spec: Extract<ScenarioSpec, { type: "budget" }>, viewer: Viewer) {
  const v = spec.inputs;
  const range = { $gte: fromDateInput(v.periodFrom), $lte: endOfDayIST(fromDateInput(v.periodTo)) };
  const match: Record<string, unknown> = { date: range };
  if (v.scope === "project" && v.projectId) {
    match.project = oid(v.projectId);
    if (v.stage) match.stage = v.stage;
  } else {
    // Company and department totals never count stock twice (see metrics.COMPANY_EXPENSES).
    Object.assign(match, COMPANY_EXPENSES);
    if (v.scope === "department") match.department = v.department;
  }
  if (!viewer.admin) match.category = { $ne: "salaries" };
  // A project or stage budget covers the whole project, not one period: spend booked before the
  // period counts against it too. Department and company budgets are for the period only.
  const lifetime = v.scope === "project" && Boolean(v.projectId);
  const [rows, prior, categories, project] = await Promise.all([
    Expense.aggregate<{ _id: { category: string; stage: ProjectStage | null }; total: number }>([
      { $match: match },
      { $group: { _id: { category: "$category", stage: "$stage" }, total: { $sum: "$amount" } } },
    ]),
    lifetime
      ? Expense.aggregate<{ _id: string; total: number }>([
          { $match: { ...match, date: { $lt: range.$gte } } },
          { $group: { _id: "$category", total: { $sum: "$amount" } } },
        ])
      : Promise.resolve([]),
    loadExpenseCategories(),
    lifetime ? loadProjects([v.projectId as string], viewer).then((p) => p[0] ?? null) : Promise.resolve(null),
  ]);
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r._id.category, round2((byCategory.get(r._id.category) ?? 0) + r.total));
  const label = (category: string) => expenseCategoryLabel(categories, category);
  return {
    rows,
    project,
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, label: label(category), amount })),
    priorByCategory: lifetime ? prior.map((r) => ({ category: r._id, label: label(r._id), amount: round2(r.total) })) : null,
  };
}

export class ScenarioDataMissing extends Error {}

/** Runs a scenario against today's recorded data. Throws ScenarioDataMissing when a record it needs is gone. */
export async function runScenario(spec: ScenarioSpec, viewer: Viewer, asOf: Date = new Date()): Promise<ScenarioResults> {
  await connectDB();
  const ctx: ComputeContext = { today: toDateInput(asOf), admin: viewer.admin };
  switch (spec.type) {
    case "demand": {
      const facts = await demandFacts(spec, viewer, asOf);
      if (!facts.items.size) throw new ScenarioDataMissing("None of the materials in this scenario is in inventory any more.");
      return computeDemand(spec.inputs, facts, ctx);
    }
    case "supply_delay": {
      const facts = await supplyDelayFacts(spec, viewer, asOf);
      if (!facts) throw new ScenarioDataMissing("The material in this scenario is no longer in inventory.");
      return computeSupplyDelay(spec.inputs, facts, ctx);
    }
    case "new_project":
      return computeNewProject(spec.inputs, await newProjectFacts(spec, viewer, asOf), ctx);
    case "price": {
      const facts = await priceFacts(spec, viewer, asOf);
      if (!facts) throw new ScenarioDataMissing("The material in this scenario is no longer in inventory.");
      return computePrice(spec.inputs, facts, ctx);
    }
    case "budget": {
      const facts = await budgetFacts(spec, viewer);
      if (spec.inputs.scope === "project" && !facts.project) throw new ScenarioDataMissing("The project in this scenario no longer exists.");
      const stagePeriod = new Map<ProjectStage, number>();
      const head = spec.inputs.head;
      for (const r of facts.rows) {
        if (!r._id.stage || (head && headOfCategory(r._id.category) !== head)) continue;
        stagePeriod.set(r._id.stage, round2((stagePeriod.get(r._id.stage) ?? 0) + r.total));
      }
      return computeBudget(
        spec.inputs,
        { byCategory: facts.byCategory, priorByCategory: facts.priorByCategory, project: facts.project, stagePeriod: [...stagePeriod.entries()].map(([stage, amount]) => ({ stage, amount })) },
        ctx,
      );
    }
    case "manpower": {
      const [people, projects] = await Promise.all([loadPeople(viewer, asOf), loadProjects(null, viewer)]);
      if (spec.inputs.scope === "project" && !projects.some((p) => p.id === spec.inputs.projectId)) throw new ScenarioDataMissing("The project in this scenario no longer exists.");
      return computeManpower(spec.inputs, { ...people, projects }, ctx);
    }
    case "equipment": {
      const [assets, projects] = await Promise.all([
        spec.inputs.assetIds.length ? loadEquipment({ ids: spec.inputs.assetIds }) : loadEquipment({ name: spec.inputs.equipmentName ?? "" }),
        loadProjects([spec.inputs.projectId], viewer),
      ]);
      return computeEquipment(spec.inputs, { assets, project: projects[0] ?? null }, ctx);
    }
  }
}
