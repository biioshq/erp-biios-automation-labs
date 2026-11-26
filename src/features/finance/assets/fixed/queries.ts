import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { BankAccount, Employee, Expense, FileModel, FixedAsset, Project, User, type FixedAssetDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { toFileDTO } from "@/features/files/server";
import type { GroupOption } from "@/features/finance/groups/types";
import { depreciationSchedule } from "@/lib/depreciation";
import { endOfDayIST, monthKeyIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { paymentState } from "@/lib/payments";
import { searchRegex } from "@/lib/list-params";
import type { AssetCondition, AssetFunding, Department, DepreciationMethod, PaymentMethod } from "@/lib/constants";
import { labelsFor, type AssetKind } from "./labels";
import { NOT_LINKABLE_SOURCES, figuresToday, isDeletableBill, isOwnBill } from "./server";
import type {
  AssetDetail,
  AssetGroupNode,
  AssetRegister,
  AssetRow,
  AssetTotals,
  LinkableExpense,
  MaintenanceEntryDTO,
  ScheduleYear,
} from "./types";

type AssetLean = FixedAssetDoc;

export type AssetListParams = { q: string; filters: Record<string, string[]> };

const oid = (id: string) => new Types.ObjectId(id);
const validIds = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((v): v is string => Boolean(v) && Types.ObjectId.isValid(v!)))].map(oid);

/** Group keys an asset of this kind may sit under. */
export function allowedGroupKeys(groups: GroupOption[], kind: AssetKind): string[] {
  return [...new Set(labelsFor(kind).roots.flatMap((r) => descendantsOf(groups, r)))];
}

function assetFilter(kind: AssetKind, params: AssetListParams, groups: GroupOption[]): Record<string, unknown> {
  const filter: Record<string, unknown> = { kind: kind === "intangible" ? "intangible" : { $ne: "intangible" } };
  const and: Record<string, unknown>[] = [];
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    and.push({ $or: [{ name: re }, { code: re }, { description: re }, { location: re }, { vendor: re }, { invoiceNumber: re }] });
  }
  if (filters.group?.length) filter.group = { $in: [...new Set(filters.group.flatMap((g) => descendantsOf(groups, g)))] };
  if (filters.condition?.length) filter.condition = { $in: filters.condition };
  if (filters.location?.length) filter.location = { $in: filters.location };
  if (filters.department?.length) filter.department = { $in: filters.department };
  if (filters.project?.length) {
    const ids = validIds(filters.project);
    filter.project = filters.project.includes("none") ? { $in: [...ids, null] } : { $in: ids };
  }
  const status = filters.status ?? [];
  if (!status.length) filter.archivedAt = null;
  else {
    const or: Record<string, unknown>[] = [];
    if (status.includes("in_use")) or.push({ archivedAt: null, disposal: { $exists: false } });
    if (status.includes("disposed")) or.push({ archivedAt: null, disposal: { $exists: true } });
    if (status.includes("archived")) or.push({ archivedAt: { $ne: null } });
    if (or.length) and.push({ $or: or });
  }
  if (and.length) filter.$and = and;
  return filter;
}

/** Names and figures the rows need, loaded once for a batch of assets. */
async function loadContext(assets: AssetLean[]) {
  const [employees, projects, accounts, expenses] = await Promise.all([
    Employee.find({ _id: { $in: validIds(assets.map((a) => idOf(a.assignedTo))) } }, { name: 1 }).lean(),
    Project.find({ _id: { $in: validIds(assets.map((a) => idOf(a.project))) } }, { name: 1, color: 1 }).lean(),
    BankAccount.find(
      { _id: { $in: validIds(assets.flatMap((a) => [idOf(a.funding?.account), idOf(a.disposal?.account)])) } },
      { name: 1 },
    ).lean(),
    Expense.find(
      { _id: { $in: validIds(assets.map((a) => idOf(a.funding?.expense))) } },
      { number: 1, vendor: 1, amount: 1, date: 1, paymentMethod: 1, payments: 1, dueDate: 1, account: 1, notes: 1, source: 1, capitalAsset: 1 },
    ).lean(),
  ]);
  return {
    employees: new Map(employees.map((e) => [String(e._id), e.name])),
    projects: new Map(projects.map((p) => [String(p._id), { name: p.name, color: p.color ?? "#4a82cc" }])),
    accounts: new Map(accounts.map((a) => [String(a._id), a.name])),
    expenses: new Map(expenses.map((e) => [String(e._id), e])),
  };
}
type RowContext = Awaited<ReturnType<typeof loadContext>> & { groups: Map<string, GroupOption>; now: Date };

function nextDue(maintenance: AssetLean["maintenance"]): string | null {
  const latest = [...(maintenance ?? [])].filter((m) => m.nextDueDate).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  return iso(latest?.nextDueDate);
}

function toRow(a: AssetLean, ctx: RowContext): AssetRow {
  const id = String(a._id);
  const f = figuresToday(a, ctx.now);
  const group = ctx.groups.get(a.group);
  const expenseId = idOf(a.funding?.expense);
  const expense = expenseId ? ctx.expenses.get(expenseId) : undefined;
  const state = expense ? paymentState(expense, ctx.now) : null;
  const accountRef = (v: unknown) => {
    const key = idOf(v as Types.ObjectId | null | undefined);
    return key ? { id: key, name: ctx.accounts.get(key) ?? "Account removed" } : null;
  };
  const projectId = idOf(a.project);
  const assignedId = idOf(a.assignedTo);
  return {
    id,
    code: a.code,
    name: a.name,
    kind: a.kind === "intangible" ? "intangible" : "tangible",
    group: a.group,
    groupLabel: group?.label ?? "Group removed",
    groupPath: group?.path ?? a.group,
    quantity: a.quantity ?? 1,
    purchaseDate: iso(a.purchaseDate)!,
    purchaseCost: round2(a.purchaseCost ?? 0),
    salvageValue: round2(a.salvageValue ?? 0),
    usefulLifeYears: a.usefulLifeYears ?? 0,
    depreciationMethod: (a.depreciationMethod ?? "slm") as DepreciationMethod,
    wdvRate: a.wdvRate ?? null,
    accumulated: f.accumulated,
    bookValue: f.bookValue,
    chargedThisYear: f.chargedThisYear,
    inBooks: !f.disposed,
    location: a.location ?? null,
    department: (a.department as Department | undefined) ?? null,
    assignedTo: assignedId ? { id: assignedId, name: ctx.employees.get(assignedId) ?? "Former employee" } : null,
    project: projectId ? { id: projectId, ...(ctx.projects.get(projectId) ?? { name: "Project removed", color: "#94a3b8" }) } : null,
    projectUntil: iso(a.projectUntil),
    isEquipment: Boolean(a.isEquipment),
    condition: (a.condition ?? "good") as AssetCondition,
    warrantyUntil: iso(a.warrantyUntil),
    vendor: a.vendor ?? null,
    invoiceNumber: a.invoiceNumber ?? null,
    funding: {
      mode: (a.funding?.mode ?? "opening") as AssetFunding,
      expense:
        expense && state
          ? {
              id: String(expense._id),
              number: expense.number,
              vendor: expense.vendor,
              amount: expense.amount,
              date: iso(expense.date)!,
              status: state.status,
              outstanding: state.outstanding,
              createdWithAsset: isOwnBill(expense, a),
            }
          : null,
      account: accountRef(a.funding?.account),
      paymentMethod: (a.funding?.paymentMethod as PaymentMethod | undefined) ?? null,
    },
    disposal: a.disposal?.date
      ? {
          date: iso(a.disposal.date)!,
          amount: round2(a.disposal.amount ?? 0),
          account: accountRef(a.disposal.account),
          notes: a.disposal.notes ?? null,
          bookValue: f.bookValue,
          gain: round2((a.disposal.amount ?? 0) - f.bookValue),
        }
      : null,
    nextMaintenanceDue: nextDue(a.maintenance),
    archived: Boolean(a.archivedAt),
  };
}

const emptyTotals = (): AssetTotals => ({ count: 0, cost: 0, accumulated: 0, bookValue: 0, disposedCount: 0 });

function addTotals(t: AssetTotals, other: AssetTotals) {
  t.count += other.count;
  t.disposedCount += other.disposedCount;
  t.cost = round2(t.cost + other.cost);
  t.accumulated = round2(t.accumulated + other.accumulated);
  t.bookValue = round2(t.bookValue + other.bookValue);
}

/** Totals count only what is still in the books, so they agree with the balance sheet. */
export function totalsOf(rows: AssetRow[]): AssetTotals {
  const t = emptyTotals();
  for (const r of rows) {
    if (!r.inBooks) {
      t.disposedCount += 1;
      continue;
    }
    t.count += 1;
    t.cost = round2(t.cost + r.purchaseCost);
    t.accumulated = round2(t.accumulated + r.accumulated);
    t.bookValue = round2(t.bookValue + r.bookValue);
  }
  return t;
}

/**
 * The register as a tree: each category under the root (Furniture and fixtures...), its subgroups
 * nested below, every node with the totals of its own assets and its subgroups'. Empty built-in
 * categories and subgroups stay visible (so subgroups can be added under them) unless a filter is on.
 */
function buildTree(kind: AssetKind, groups: GroupOption[], rows: AssetRow[], filtered: boolean): AssetGroupNode[] {
  const byGroup = new Map<string, AssetRow[]>();
  for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  const allowed = new Set(allowedGroupKeys(groups, kind));
  // An archived subgroup shows only while something is still filed under it.
  const visible = (g: GroupOption) => allowed.has(g.key) && (!g.archived || groups.some((x) => x.parent === g.key) || byGroup.has(g.key));

  const node = (g: GroupOption, depth: number, withChildren = true): AssetGroupNode => {
    const children = withChildren ? groups.filter((c) => c.parent === g.key && visible(c)).map((c) => node(c, depth + 1)) : [];
    const assets = byGroup.get(g.key) ?? [];
    const totals = totalsOf(assets);
    for (const c of children) addTotals(totals, c.totals);
    return { key: g.key, label: g.label, depth, builtIn: g.builtIn, description: g.description, assets, children, totals };
  };
  const hasAny = (n: AssetGroupNode): boolean => n.assets.length > 0 || n.children.some(hasAny);
  const prune = (n: AssetGroupNode): AssetGroupNode => ({ ...n, children: n.children.filter(hasAny).map(prune) });

  const { roots, root } = labelsFor(kind);
  const out: AssetGroupNode[] = [];
  const main = groups.find((g) => g.key === root);
  if (main) {
    // Assets filed on the root itself, then one section per category under it.
    if ((byGroup.get(root) ?? []).length) out.push({ ...node(main, 0, false), label: `${main.label}, no category` });
    for (const c of groups.filter((g) => g.parent === root && visible(g))) out.push(node(c, 0));
  }
  for (const key of roots.filter((r) => r !== root)) {
    const g = groups.find((x) => x.key === key);
    if (!g) continue;
    const n = node(g, 0);
    if (hasAny(n)) out.push(n);
  }
  // Records filed under a group that no longer exists still show, so nothing disappears from view.
  const orphans = rows.filter((r) => !allowed.has(r.group));
  if (orphans.length) {
    out.push({ key: "_unknown", label: "Other groups", depth: 0, builtIn: false, description: null, assets: orphans, children: [], totals: totalsOf(orphans) });
  }
  return filtered ? out.filter(hasAny).map(prune) : out;
}

export async function listAssets(kind: AssetKind, params: AssetListParams): Promise<AssetRegister> {
  await connectDB();
  const groups = await loadFinanceGroups("asset", { includeArchived: true });
  const docs = await FixedAsset.find(assetFilter(kind, params, groups)).sort({ purchaseDate: -1, _id: -1 }).lean();
  const ctx = { ...(await loadContext(docs)), groups: new Map(groups.map((g) => [g.key, g])), now: new Date() };
  const rows = docs.map((d) => toRow(d, ctx));
  const filtered = Boolean(params.q || Object.keys(params.filters).length);
  return { rows, tree: buildTree(kind, groups, rows, filtered), totals: totalsOf(rows), filtered };
}

/** Locations already used, for the filter and the form's suggestions. */
export async function getAssetLocations(kind: AssetKind): Promise<string[]> {
  await connectDB();
  const values = (await FixedAsset.distinct("location", { kind: kind === "intangible" ? "intangible" : { $ne: "intangible" } })) as (string | null)[];
  return values.filter((v): v is string => Boolean(v)).sort((a, b) => a.localeCompare(b));
}

const FY_OF = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

/**
 * Month by month, grouped by financial year: what was charged up to today and what the same rules
 * will charge later (marked planned). A written down value schedule never reaches zero, so it is
 * shown five years ahead.
 */
function buildSchedule(a: AssetLean, now: Date): { years: ScheduleYear[]; cut: boolean } {
  const start = new Date(a.depreciationStart ?? a.purchaseDate);
  const lifeMonths = Math.round((a.usefulLifeYears ?? 0) * 12);
  const method = a.depreciationMethod ?? "slm";
  const DAY = 24 * 60 * 60 * 1000;
  const horizon =
    a.disposal?.date
      ? new Date(a.disposal.date)
      : method === "slm"
        ? new Date(start.getTime() + (lifeMonths + 2) * 31 * DAY)
        : new Date(Math.max(now.getTime(), start.getTime()) + 5 * 366 * DAY);
  const months = depreciationSchedule(a, endOfDayIST(horizon));
  const current = monthKeyIST(now);
  const cost = a.purchaseCost ?? 0;
  const years: ScheduleYear[] = [];
  let book = cost;
  for (const m of months) {
    const label = FY_OF(m.month);
    let year = years[years.length - 1];
    if (!year || year.label !== label) {
      year = { label, opening: round2(book), charge: 0, closing: round2(book), planned: true, months: [] };
      years.push(year);
    }
    book = round2(book - m.amount);
    const planned = m.month > current;
    year.months.push({ month: m.month, amount: m.amount, closing: book, planned });
    year.charge = round2(year.charge + m.amount);
    year.closing = book;
    if (!planned) year.planned = false;
  }
  const cut = !a.disposal?.date && method === "wdv" && months.length > 0;
  return { years, cut };
}

/** One expense that can be linked as a new asset's purchase, or null when it cannot (taken, salary, stock...). */
export async function findLinkableExpense(id: string): Promise<LinkableExpense | null> {
  return (await findLinkableExpenses(undefined, undefined, id))[0] ?? null;
}

export async function getAsset(id: string): Promise<AssetDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const a = await FixedAsset.findById(id).lean();
  if (!a) return null;
  const groups = await loadFinanceGroups("asset", { includeArchived: true });
  const now = new Date();
  const ctx = { ...(await loadContext([a])), groups: new Map(groups.map((g) => [g.key, g])), now };
  const row = toRow(a, ctx);
  const entryExpenseIds = validIds((a.maintenance ?? []).map((m) => idOf(m.expense)));
  const [entryExpenses, files, creator] = await Promise.all([
    entryExpenseIds.length ? Expense.find({ _id: { $in: entryExpenseIds } }, { number: 1, amount: 1 }).lean() : Promise.resolve([]),
    FileModel.find({ "entity.type": "fixed_asset", "entity.id": a._id }).sort({ createdAt: -1 }).lean(),
    a.createdBy ? User.findById(a.createdBy, { name: 1 }).lean() : Promise.resolve(null),
  ]);
  const entryExpense = new Map(entryExpenses.map((e) => [String(e._id), e]));
  const maintenance: MaintenanceEntryDTO[] = [...(a.maintenance ?? [])]
    .sort((x, y) => y.date.getTime() - x.date.getTime())
    .map((m) => {
      const e = m.expense ? entryExpense.get(String(m.expense)) : undefined;
      return {
        id: String(m._id),
        date: iso(m.date)!,
        description: m.description,
        cost: round2(e ? e.amount : (m.cost ?? 0)),
        vendor: m.vendor ?? null,
        nextDueDate: iso(m.nextDueDate),
        expense: e ? { id: String(e._id), number: e.number, amount: e.amount } : null,
      };
    });
  const { years, cut } = buildSchedule(a, now);
  const bill = a.funding?.expense ? ctx.expenses.get(String(a.funding.expense)) : undefined;
  return {
    ...row,
    description: a.description ?? null,
    depreciationStart: iso(a.depreciationStart),
    warrantyNotes: a.warrantyNotes ?? null,
    notes: a.notes ?? null,
    maintenance,
    maintenanceTotal: round2(maintenance.reduce((s, m) => s + m.cost, 0)),
    schedule: years,
    scheduleCut: cut,
    documents: files.map(toFileDTO),
    deletableBill: bill && isDeletableBill(bill, a) ? { id: String(bill._id), number: bill.number } : null,
    createdBy: creator ? { id: String(creator._id), name: creator.name ?? "" } : null,
    createdAt: iso(a.createdAt as Date)!,
    updatedAt: iso(a.updatedAt as Date)!,
  };
}

/**
 * Company expenses that can be linked as an asset's purchase: manual or recurring ones, not salary,
 * not prepaid, not already the purchase of another asset. Newest first.
 */
export async function findLinkableExpenses(q: string | undefined, assetId?: string, onlyId?: string): Promise<LinkableExpense[]> {
  await connectDB();
  if (onlyId !== undefined && !Types.ObjectId.isValid(onlyId)) return [];
  const self = assetId && Types.ObjectId.isValid(assetId) ? oid(assetId) : null;
  const taken = await FixedAsset.find({ "funding.expense": { $type: "objectId" }, ...(self ? { _id: { $ne: self } } : {}) }, { funding: 1 }).lean();
  const takenIds = taken.map((t) => t.funding?.expense).filter((v): v is Types.ObjectId => Boolean(v));
  const filter: Record<string, unknown> = {
    _id: { $nin: takenIds },
    source: { $nin: NOT_LINKABLE_SOURCES },
    countedAtPurchase: { $ne: true },
    category: { $ne: "salaries" },
    "prepaid.from": { $exists: false },
    $and: [{ $or: [{ capitalAsset: { $exists: false } }, { capitalAsset: null }, ...(self ? [{ capitalAsset: self }] : [])] }],
  };
  if (q) {
    const re = searchRegex(q);
    (filter.$and as Record<string, unknown>[]).push({ $or: [{ number: re }, { vendor: re }, { description: re }, { "gst.invoiceNumber": re }] });
  }
  // One expense by id (a link that opens the form prefilled), under the same rules as the search.
  if (onlyId !== undefined) (filter.$and as Record<string, unknown>[]).push({ _id: oid(onlyId) });
  const docs = await Expense.find(filter)
    .select({ number: 1, vendor: 1, date: 1, amount: 1, gst: 1, category: 1, description: 1, paymentMethod: 1, payments: 1, dueDate: 1 })
    .sort({ date: -1, _id: -1 })
    .limit(20)
    .lean();
  return docs.map((e) => {
    const g = e.gst;
    const tax = round2((g?.cgst ?? 0) + (g?.sgst ?? 0) + (g?.igst ?? 0) + (g?.cess ?? 0));
    return {
      id: String(e._id),
      number: e.number,
      vendor: e.vendor,
      date: iso(e.date)!,
      amount: e.amount,
      gst: Math.min(tax, e.amount),
      category: e.category,
      description: e.description ?? null,
      invoiceNumber: g?.invoiceNumber ?? null,
      status: paymentState(e).status,
    };
  });
}
