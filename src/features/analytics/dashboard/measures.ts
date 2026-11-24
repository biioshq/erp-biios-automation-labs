import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, Expense, FixedAsset, InventoryMovement, Project, ProjectMember, Task } from "@/server/models";
import { itemPositions, lookAheadAlerts, type StockAlert } from "@/server/analytics/core";
import { projectSpend } from "@/server/services/metrics";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { addDays, endOfDayIST, fromDateInput, monthKeyIST, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { ProjectStatus } from "@/lib/constants";
import { spendTypeOf } from "@/lib/project-cost-types";
import { forecastProjectCost } from "../project-forecast";
import { budgetUse, type BudgetUse } from "../projects/model";
import { resolveWindow } from "../forecasting/params";
import { purchasePlan } from "../forecasting/server/purchases";
import { UNDATED, getAgeing } from "../inventory/ageing-queries";
import { getVelocity } from "../inventory/velocity-queries";
import { DEFAULT_AGE_EDGES, parseRange } from "../inventory/params";
import { LOOK_AHEAD_DAYS, daysBetween } from "./rules";
import type { Bucket, Manpower, MaintenanceDue, MonthlyStock, ProjectCostRow, ProjectHealth, PurchaseRequirement } from "./types";

/**
 * Measures shared by the Analytics dashboard and the management insights pages. Read-only. Where
 * a detailed Analytics page shows the same figure, the figure here comes from that page's own
 * function, not a copy of its rule, so a card and the page it opens agree:
 *  - project cost forecast: forecastProjectCost (src/features/analytics/project-forecast.ts)
 *  - budget used: budgetUse (src/features/analytics/projects/model.ts)
 *  - purchase requirements: purchasePlan (forecasting/server/purchases.ts)
 *  - ageing: getAgeing (inventory/ageing-queries.ts); fast and slow: getVelocity (inventory/velocity-queries.ts)
 *  - cost types: spendTypeOf (src/lib/project-cost-types.ts)
 * Nothing is guessed: without the records a figure needs, it is left out and the reason is kept.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const OPEN_PROJECT_STATUSES: ProjectStatus[] = ["planning", "active", "on_hold"];
const CLOSED_TASKS = ["completed", "cancelled"];

/* Projects */

type TaskCounts = { total: number; done: number; overdue: number };

/** Tasks per project: open and done (cancelled left out of the total) and overdue (due before today, not closed). */
async function taskCounts(now: Date): Promise<Map<string, TaskCounts>> {
  const today = startOfDayIST(now);
  const rows = await Task.aggregate<{ _id: Types.ObjectId } & TaskCounts>([
    { $match: { project: { $ne: null } } },
    {
      $group: {
        _id: "$project",
        total: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, 1, 0] } },
        done: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        overdue: {
          $sum: {
            $cond: [{ $and: [{ $gt: ["$dueDate", null] }, { $lt: ["$dueDate", today] }, { $not: [{ $in: ["$status", CLOSED_TASKS] }] }] }, 1, 0],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { total: r.total, done: r.done, overdue: r.overdue }]));
}

/** Every project with its spend, tasks, delay flags and cost forecast, newest first. */
export async function projectHealth(includeSalaries: boolean, now: Date = new Date()): Promise<ProjectHealth[]> {
  await connectDB();
  const projects = await Project.find({}, { code: 1, name: 1, client: 1, color: 1, status: 1, budget: 1, contractValue: 1, startDate: 1, endDate: 1 })
    .sort({ createdAt: -1 })
    .lean();
  const [spend, tasks] = await Promise.all([projectSpend(projects.map((p) => p._id), { includeSalaries }), taskCounts(now)]);
  const today = toDateInput(now);
  return projects.map((p) => {
    const id = String(p._id);
    const spent = spend.get(id)?.spent ?? 0;
    const budget = p.budget ?? 0;
    const startDate = p.startDate ? toDateInput(p.startDate) : null;
    const endDate = p.endDate ? toDateInput(p.endDate) : null;
    const t = tasks.get(id) ?? { total: 0, done: 0, overdue: 0 };
    const active = p.status === "active";
    const pastEnd = active && Boolean(endDate && endDate < today);
    const planned = startDate && endDate ? Math.max(1, daysBetween(startDate, endDate) + 1) : null;
    // The shared project forecast rule, for open projects only (closed ones have nothing to forecast).
    const open = OPEN_PROJECT_STATUSES.includes(p.status as ProjectStatus);
    const forecast = open ? forecastProjectCost({ status: p.status, startDate, endDate, budget, spent }, today) : null;
    return {
      id,
      code: p.code,
      name: p.name,
      color: p.color ?? "#4a82cc",
      status: p.status as ProjectStatus,
      client: p.client ?? null,
      budget,
      spent,
      usage: budget > 0 ? spent / budget : null,
      contractValue: typeof p.contractValue === "number" ? p.contractValue : null,
      startDate,
      endDate,
      tasks: t,
      pastEnd,
      atRisk: active && (t.overdue > 0 || pastEnd),
      timeElapsed: planned && startDate ? Math.max(0, daysBetween(startDate, today) + 1) / planned : null,
      forecast,
    };
  });
}

/** Budget used by active projects, the shared measure (projects with a budget only), as on Budget vs actual. */
export function activeBudgetUse(rows: ProjectHealth[]): BudgetUse {
  return budgetUse(rows.filter((r) => r.status === "active"));
}

/** Spend per project split into materials, labour, equipment, transport and other. Totals equal projectSpend. */
export async function projectCosts(projects: { id: string; name: string }[], includeSalaries: boolean): Promise<ProjectCostRow[]> {
  if (!projects.length) return [];
  await connectDB();
  const ids = projects.map((p) => new Types.ObjectId(p.id));
  const rows = await Expense.aggregate<{ _id: { project: Types.ObjectId; category: string }; total: number }>([
    { $match: { project: { $in: ids }, ...(includeSalaries ? {} : { category: { $ne: "salaries" } }) } },
    { $group: { _id: { project: "$project", category: "$category" }, total: { $sum: "$amount" } } },
  ]);
  const out = new Map(projects.map((p) => [p.id, { id: p.id, name: p.name, material: 0, labour: 0, equipment: 0, transport: 0, other: 0, total: 0 }]));
  for (const r of rows) {
    const row = out.get(String(r._id.project));
    if (!row) continue;
    const type = spendTypeOf(r._id.category);
    row[type] = round2(row[type] + r.total);
    row.total = round2(row.total + r.total);
  }
  return [...out.values()];
}

/* Stock: purchase requirements (the Purchase requirements page's own function) */

/** The horizon purchases cover, as the Purchase requirements page's default. */
export const PURCHASE_HORIZON_DAYS = 30;

/**
 * Items to buy, straight from the Purchase requirements page (purchasePlan) with its default
 * window, no filters and a 30-day horizon, so the card and the page always list the same items.
 * The alert level is the shared look-ahead alert of the item, when it has one.
 */
async function requirementsFromPlan(alerts: StockAlert[], now: Date): Promise<PurchaseRequirement[]> {
  const plan = await purchasePlan(resolveWindow({}, now), { item: null, category: null, project: null }, PURCHASE_HORIZON_DAYS, now);
  const today = toDateInput(now);
  const alertOf = new Map(alerts.map((a) => [a.id, a.level]));
  return plan.rows
    .filter((r) => r.suggestedQty > 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      unit: r.unit,
      available: r.available,
      minStock: r.minStock,
      perDay: r.perDay,
      leadTimeDays: r.leadTimeDays,
      reorderDate: r.reorderDate ?? today,
      orderNow: (r.reorderDate ?? today) <= today,
      qty: r.suggestedQty,
      basis: r.basis === "forecast" ? ("forecast" as const) : ("minimum" as const),
      price: r.price,
      priceBasis: r.priceBasis,
      estimatedCost: r.estimatedCost,
      alert: alertOf.get(r.id) ?? null,
    }))
    .sort((a, b) => a.reorderDate.localeCompare(b.reorderDate) || a.name.localeCompare(b.name));
}

/** Stock positions, the shared alerts and the purchase requirements in one read. */
export async function stockOutlook(now: Date = new Date()) {
  const [positions, alerts] = await Promise.all([itemPositions(), lookAheadAlerts(now)]);
  const requirements = await requirementsFromPlan(alerts, now);
  return { positions, alerts, requirements };
}

export function requirementTotals(rows: PurchaseRequirement[]) {
  return {
    count: rows.length,
    cost: round2(rows.reduce((s, r) => s + (r.estimatedCost ?? 0), 0)),
    unknownCost: rows.filter((r) => r.estimatedCost === null).length,
  };
}

/* Stock: monthly flows, ageing and movement speed */

/** Months from `months - 1` months back to this one, oldest first. */
export function monthKeys(months: number, now: Date = new Date()): string[] {
  return Array.from({ length: months }, (_, i) => monthKeyIST(startOfMonthIST(now, -(months - 1) + i)));
}

/** Stock used, wasted, bought and entered as opening stock, by month (value at cost). */
export async function monthlyStock(months: number, now: Date = new Date()): Promise<MonthlyStock[]> {
  await connectDB();
  const from = startOfMonthIST(now, -(months - 1));
  const rows = await InventoryMovement.aggregate<{ _id: { month: string; type: string; bought: boolean }; value: number }>([
    { $match: { date: { $gte: from, $lte: endOfDayIST(now) }, type: { $in: ["purchase", "assign", "return", "wastage"] } } },
    {
      $group: {
        _id: { month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } }, type: "$type", bought: { $gt: ["$expense", null] } },
        value: { $sum: "$totalCost" },
      },
    },
  ]);
  const by = new Map(monthKeys(months, now).map((m) => [m, { month: m, consumed: 0, wasted: 0, bought: 0, opening: 0 }]));
  for (const r of rows) {
    const m = by.get(r._id.month);
    if (!m) continue;
    if (r._id.type === "assign") m.consumed += r.value;
    else if (r._id.type === "return") m.consumed -= r.value;
    else if (r._id.type === "wastage") m.wasted += r.value;
    else if (r._id.bought) m.bought += r.value;
    else m.opening += r.value;
  }
  return [...by.values()].map((m) => ({ month: m.month, consumed: round2(Math.max(0, m.consumed)), wasted: round2(m.wasted), bought: round2(m.bought), opening: round2(m.opening) }));
}

/** Age bucket edges, as on Inventory ageing by default. */
export const AGE_EDGES = DEFAULT_AGE_EDGES;

/**
 * Stock in storage by age, straight from Inventory ageing (getAgeing with its default edges):
 * FIFO over recorded purchases, opening stock already on hand and other uncovered units have no
 * known age. Valued at the item's average cost, so the buckets add up to the inventory value.
 */
export async function ageingBuckets(now: Date = new Date()): Promise<Bucket[]> {
  const data = await getAgeing([...AGE_EDGES], now);
  const buckets: Bucket[] = data.totals.map((t) => ({
    key: t.key,
    label: t.max === null ? `More than ${t.min - 1} days` : `${t.min} to ${t.max} days`,
    items: t.items,
    value: t.value,
  }));
  return [...buckets, { key: UNDATED, label: "Age not recorded", items: data.undated.items, value: data.undated.value }];
}

/** Days the movement speed is judged over, as Fast and slow moving by default. */
export const VELOCITY_DAYS = 90;

/**
 * Fast, steady and slow moving over the last 90 days, straight from Fast and slow moving
 * (getVelocity with its default range). With fewer than MIN_RANKED items issued, none is ranked;
 * not moving is stock in storage with no issue in the period, recorded before it began.
 * Values are stock in storage at average cost.
 */
export async function velocityBuckets(now: Date = new Date()): Promise<Bucket[]> {
  const range = parseRange({}, VELOCITY_DAYS, now);
  const data = await getVelocity(range);
  const out: Record<string, Bucket> = {
    fast: { key: "fast", label: "Fast moving", items: 0, value: 0 },
    steady: { key: "steady", label: "Steady", items: 0, value: 0 },
    slow: { key: "slow", label: "Slow moving", items: 0, value: 0 },
    unranked: { key: "unranked", label: "Issued, too few to rank", items: 0, value: 0 },
    idle: { key: "idle", label: "Not moving", items: 0, value: 0 },
    added: { key: "added", label: "Added recently, not issued", items: 0, value: 0 },
  };
  const add = (key: string, value: number) => {
    out[key].items += 1;
    out[key].value = round2(out[key].value + value);
  };
  for (const r of data.rows) {
    if (r.issues > 0) add(r.velocity ?? "unranked", r.value);
  }
  for (const r of data.nonMoving) add("idle", r.value);
  // Stock first recorded inside the period has not had the whole period to move (as on the page).
  for (const r of data.rows) if (r.issues === 0 && r.available > 0 && r.firstRecorded !== null && r.firstRecorded > range.from) add("added", r.value);
  return Object.values(out).filter((b) => (b.key !== "unranked" && b.key !== "added") || b.items > 0);
}

/* Equipment and people */

/** Fixed asset groups counted as equipment (with their subgroups), as on Equipment maintenance. */
const EQUIPMENT_GROUPS = ["plant_machinery", "computers_electronics", "vehicles"] as const;

/** Equipment in use: tangible, not disposed, lost or archived, marked as equipment or in an equipment group. */
async function equipmentFilter(): Promise<Record<string, unknown>> {
  const groups = await loadFinanceGroups("asset", { includeArchived: true });
  const keys = [...new Set(EQUIPMENT_GROUPS.flatMap((root) => descendantsOf(groups, root)))];
  return { archivedAt: null, disposal: null, condition: { $nin: ["disposed", "lost"] }, kind: "tangible", $or: [{ isEquipment: true }, { group: { $in: keys } }] };
}

type Service = { date: Date; description: string; nextDueDate?: Date | null };

/** Next service: the due date on the latest entry, or the last service plus the average gap between two or more. */
function nextService(entries: Service[]): { due: string; basis: MaintenanceDue["basis"] } | null {
  const last = entries.at(-1);
  if (last?.nextDueDate) return { due: toDateInput(last.nextDueDate), basis: "recorded" };
  const days = [...new Set(entries.map((e) => toDateInput(e.date)))];
  if (days.length < 2) return null;
  const stamps = days.map((d) => fromDateInput(d).getTime());
  const gaps = stamps.slice(1).map((t, i) => (t - stamps[i]) / DAY_MS);
  const interval = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
  return { due: toDateInput(addDays(new Date(stamps.at(-1)!), interval)), basis: "interval" };
}

/** Equipment with a service due within `days` or already past due, soonest first (the Equipment maintenance rule). */
export async function maintenanceDue(now: Date = new Date(), days = LOOK_AHEAD_DAYS): Promise<MaintenanceDue[]> {
  await connectDB();
  const assets = await FixedAsset.find(await equipmentFilter(), { code: 1, name: 1, maintenance: 1 }).lean();
  const today = toDateInput(now);
  const out: MaintenanceDue[] = [];
  for (const a of assets) {
    const entries: Service[] = [...(a.maintenance ?? [])].sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
    const next = nextService(entries);
    if (!next) continue;
    const dueIn = daysBetween(today, next.due);
    if (dueIn > days) continue;
    const last = entries.at(-1);
    out.push({
      id: String(a._id),
      code: a.code,
      name: a.name,
      lastDate: last ? toDateInput(last.date) : null,
      lastDescription: last?.description ?? null,
      dueDate: next.due,
      basis: next.basis,
      dueIn,
      overdue: dueIn < 0,
    });
  }
  return out.sort((a, b) => a.dueIn - b.dueIn);
}

/** Equipment and how much of it is out on projects today. */
export async function equipmentUse(now: Date = new Date()) {
  await connectDB();
  const today = startOfDayIST(now);
  const rows = await FixedAsset.find(await equipmentFilter(), { code: 1, name: 1, project: 1, projectUntil: 1, condition: 1 })
    .populate<{ project: { _id: Types.ObjectId; name: string } | null }>("project", "name")
    .sort({ name: 1 })
    .lean();
  return rows.map((a) => {
    const onProject = Boolean(a.project && (!a.projectUntil || a.projectUntil.getTime() >= today.getTime()));
    return {
      id: String(a._id),
      code: a.code,
      name: a.name,
      condition: a.condition ?? "good",
      project: onProject && a.project ? { id: String(a.project._id), name: a.project.name } : null,
      until: onProject && a.projectUntil ? toDateInput(a.projectUntil) : null,
    };
  });
}

/**
 * Current allocation per person, the Manpower requirement rule: memberships on active or on-hold
 * projects that have started (the membership's start, else the project's) and not ended. People
 * above 100%, and active projects with no current or upcoming member.
 */
export async function manpower(now: Date = new Date()): Promise<Manpower> {
  await connectDB();
  const today = startOfDayIST(now);
  const [projects, employees] = await Promise.all([
    Project.find({ status: { $in: OPEN_PROJECT_STATUSES } }, { name: 1, code: 1, status: 1, startDate: 1, endDate: 1 }).lean(),
    Employee.find({ status: { $ne: "exited" } }, { name: 1, department: 1 }).sort({ name: 1 }).lean(),
  ]);
  const members = await ProjectMember.find(
    { employee: { $in: employees.map((e) => e._id) }, project: { $in: projects.map((p) => p._id) }, $or: [{ endDate: null }, { endDate: { $gte: today } }] },
    { project: 1, employee: 1, allocation: 1, startDate: 1, endDate: 1 },
  ).lean();
  const projectOf = new Map(projects.map((p) => [String(p._id), p]));
  const staffed = new Set<string>();
  const loads = new Map(employees.map((e) => [String(e._id), { id: String(e._id), name: e.name, department: e.department ?? "", allocation: 0, projects: [] as { id: string; name: string; allocation: number }[] }]));
  for (const m of members) {
    const p = projectOf.get(String(m.project));
    const load = loads.get(String(m.employee));
    if (!p || !load) continue;
    const start = m.startDate ?? p.startDate ?? null;
    const end = m.endDate ?? p.endDate ?? null;
    if (end && startOfDayIST(end) < today) continue;
    staffed.add(String(p._id));
    const upcoming = p.status === "planning" || Boolean(start && startOfDayIST(start) > today);
    if (upcoming) continue;
    const share = m.allocation ?? 100;
    load.allocation += share;
    load.projects.push({ id: String(p._id), name: p.name, allocation: share });
  }
  const list = [...loads.values()];
  return {
    employees: list,
    overAllocated: list.filter((e) => e.allocation > 100).sort((a, b) => b.allocation - a.allocation),
    unstaffed: projects.filter((p) => p.status === "active" && !staffed.has(String(p._id))).map((p) => ({ id: String(p._id), name: p.name, code: p.code })),
  };
}
