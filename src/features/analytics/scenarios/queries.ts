import "server-only";

import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, FixedAsset, InventoryItem, Project, Scenario, User, type ScenarioDoc } from "@/server/models";
import { budgetUsage } from "@/server/services/metrics";
import { getVendorNames } from "@/server/lookups";
import { roundQty } from "@/server/services/inventory-ledger";
import { DEPARTMENTS, type ScenarioStatus, type ScenarioType } from "@/lib/constants";
import { dateRangeFilter } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { ADMIN_ONLY_INPUTS, parseSpec, type ScenarioSpec } from "./schemas";
import { describeInputs, type NameLookup } from "./describe";
import { compareMatrix, type BusinessPosition, type CompareColumn, type CompareRow } from "./compare";
import { departmentCapacity } from "./compute/capacity";
import { ScenarioDataMissing, loadCash, loadEquipment, loadPeople, runScenario, type Viewer } from "./server/run";
import type { HistoryEntry, HistoryRow, ScenarioDetail, ScenarioFormOptions, ScenarioResults, ScenarioRow } from "./types";

/** Scenario lists, detail, history and form options. Read-only. */

type Lean = ScenarioDoc & { createdAt: Date; updatedAt: Date };

/** Display names of the people who created scenarios; falls back to the name recorded in history. */
async function userNames(ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map(String))].filter((id) => Types.ObjectId.isValid(id));
  if (!list.length) return new Map();
  const users = await User.find({ _id: { $in: list.map((id) => new Types.ObjectId(id)) } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name ?? ""]));
}

function creatorOf(doc: Pick<Lean, "createdBy" | "history">, names: Map<string, string>): string | null {
  const fromUser = doc.createdBy ? names.get(String(doc.createdBy)) : undefined;
  return fromUser || doc.history?.[0]?.byName || null;
}

function toRow(doc: Lean, names: Map<string, string>): ScenarioRow {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    type: doc.type as ScenarioType,
    status: (doc.status ?? "draft") as ScenarioStatus,
    createdBy: creatorOf(doc, names),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listScenarios(params: ListParams): Promise<Paginated<ScenarioRow>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (params.q) {
    const re = searchRegex(params.q);
    filter.$or = [{ name: re }, { code: re }, { description: re }];
  }
  if (params.filters.type?.length) filter.type = { $in: params.filters.type };
  if (params.filters.status?.length) filter.status = { $in: params.filters.status };
  if (params.filters.creator?.length) filter.createdBy = { $in: params.filters.creator.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.createdAt = range;
  const [docs, total] = await Promise.all([
    Scenario.find(filter, { code: 1, name: 1, type: 1, status: 1, createdBy: 1, createdAt: 1, updatedAt: 1, history: { $slice: 1 } })
      .sort(mongoSort(params.sort))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean<Lean[]>(),
    Scenario.countDocuments(filter),
  ]);
  const names = await userNames(docs.map((d) => d.createdBy));
  return { rows: docs.map((d) => toRow(d, names)), total, page: params.page, pageSize: params.pageSize };
}

/** People who created scenarios, for the list filter. */
export async function getScenarioCreators(): Promise<{ value: string; label: string }[]> {
  await connectDB();
  const ids = (await Scenario.distinct("createdBy")) as Types.ObjectId[];
  const names = await userNames(ids);
  return ids.filter(Boolean).map((id) => ({ value: String(id), label: names.get(String(id)) || "Unknown" })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Names of the projects, materials and equipment a set of scenarios refers to. */
export async function nameLookup(specs: ScenarioSpec[]): Promise<NameLookup> {
  const projectIds = new Set<string>();
  const itemIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const s of specs) {
    const v = s.inputs as Record<string, unknown>;
    for (const key of ["projectIds"]) for (const id of (v[key] as string[] | undefined) ?? []) projectIds.add(id);
    if (typeof v.projectId === "string") projectIds.add(v.projectId);
    if (typeof v.itemId === "string") itemIds.add(v.itemId);
    for (const m of (v.materials as { itemId: string }[] | undefined) ?? []) itemIds.add(m.itemId);
    for (const id of (v.assetIds as string[] | undefined) ?? []) assetIds.add(id);
    for (const e of (v.equipment as { assetId?: string }[] | undefined) ?? []) if (e.assetId) assetIds.add(e.assetId);
  }
  const oids = (set: Set<string>) => [...set].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const [projects, items, assets] = await Promise.all([
    projectIds.size ? Project.find({ _id: { $in: oids(projectIds) } }, { name: 1 }).lean() : [],
    itemIds.size ? InventoryItem.find({ _id: { $in: oids(itemIds) } }, { name: 1 }).lean() : [],
    assetIds.size ? FixedAsset.find({ _id: { $in: oids(assetIds) } }, { name: 1, code: 1 }).lean() : [],
  ]);
  return {
    projects: new Map(projects.map((p) => [String(p._id), p.name])),
    items: new Map(items.map((i) => [String(i._id), i.name])),
    assets: new Map(assets.map((a) => [String(a._id), `${a.name} (${a.code})`])),
  };
}

/** Stored inputs without the fields only admins see. */
export function inputsForViewer(type: string, inputs: unknown, viewer: Viewer): Record<string, unknown> {
  const copy = { ...((inputs ?? {}) as Record<string, unknown>) };
  if (!viewer.admin) for (const key of ADMIN_ONLY_INPUTS[type as ScenarioType] ?? []) delete copy[key];
  return copy;
}

/** A member's spec never carries admin-only inputs into a calculation either. */
export function specForViewer(spec: ScenarioSpec, viewer: Viewer): ScenarioSpec {
  return { ...spec, inputs: inputsForViewer(spec.type, spec.inputs, viewer) } as ScenarioSpec;
}

const near = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : a === b);

/** Parameters whose saved and today's figures differ. */
export function changedParameters(saved: ScenarioResults, live: ScenarioResults): string[] {
  const out: string[] = [];
  const liveStats = new Map(live.stats.map((s) => [s.key, s]));
  for (const s of saved.stats) {
    const l = liveStats.get(s.key);
    if (l && !near(s.value, l.value)) out.push(s.label);
  }
  const liveRows = new Map(live.comparison.map((r) => [r.key, r]));
  for (const r of saved.comparison) {
    const l = liveRows.get(r.key);
    if (!l) continue;
    if (!near(r.current, l.current) || !near(r.scenario, l.scenario)) if (!out.includes(r.parameter)) out.push(r.parameter);
  }
  return out;
}

/** Whether this viewer may see a saved snapshot. Members never see one computed with admin-only figures. */
export function savedVisible(saved: ScenarioResults | null, viewer: Viewer): { results: ScenarioResults | null; hidden: string | null } {
  if (!saved) return { results: null, hidden: null };
  if (saved.view === "admin" && !viewer.admin) return { results: null, hidden: "The saved figures were worked out by an admin and include salary or cash figures that only admins see. Today's figures below leave those out." };
  return { results: saved, hidden: null };
}

async function liveResults(spec: ScenarioSpec | null, viewer: Viewer): Promise<{ results: ScenarioResults | null; error: string | null }> {
  if (!spec) return { results: null, error: "The saved inputs no longer pass the checks. Edit the scenario to fix them." };
  try {
    return { results: await runScenario(specForViewer(spec, viewer), viewer), error: null };
  } catch (error) {
    if (error instanceof ScenarioDataMissing) return { results: null, error: error.message };
    throw error;
  }
}

function historyOf(doc: Lean): HistoryEntry[] {
  return (doc.history ?? [])
    .map((h) => ({
      at: new Date(h.at).toISOString(),
      byName: h.byName ?? null,
      action: h.action,
      changes: h.changes ?? [],
      status: (h.status ?? null) as ScenarioStatus | null,
      note: h.note ?? null,
    }))
    .reverse();
}

export async function getScenarioDetail(id: string, viewer: Viewer): Promise<ScenarioDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const doc = await Scenario.findById(id).lean<Lean>();
  if (!doc) return null;
  const spec = parseSpec(doc.type, doc.inputs);
  const [names, lookup, live, source] = await Promise.all([
    userNames([doc.createdBy]),
    nameLookup(spec ? [spec] : []),
    liveResults(spec, viewer),
    doc.duplicatedFrom ? Scenario.findById(doc.duplicatedFrom, { code: 1, name: 1 }).lean() : Promise.resolve(null),
  ]);
  const saved = savedVisible((doc.results ?? null) as ScenarioResults | null, viewer);
  // A member's snapshot leaves out salary and cash figures an admin sees today: that is not a change in the records.
  const otherView = Boolean(saved.results && live.results && saved.results.view !== live.results.view);
  return {
    ...toRow(doc, names),
    description: doc.description ?? null,
    assumptions: doc.assumptions ?? null,
    inputs: inputsForViewer(doc.type, doc.inputs, viewer),
    inputSummary: spec ? describeInputs(specForViewer(spec, viewer), lookup, { admin: viewer.admin }) : [],
    duplicatedFrom: source ? { id: String(source._id), code: source.code, name: source.name } : null,
    history: historyOf(doc),
    saved: saved.results,
    savedAt: doc.computedAt ? new Date(doc.computedAt).toISOString() : null,
    savedHidden: saved.hidden,
    savedNote: otherView ? "The saved figures were worked out for a member, so they leave out salary and cash figures. Update the saved results to keep today's full figures." : null,
    live: live.results,
    liveError: live.error,
    changedSinceSave: saved.results && live.results && !otherView ? changedParameters(saved.results, live.results) : [],
  };
}

/** Pickers for the scenario forms. Salary averages only for admins. */
export async function getScenarioFormOptions(viewer: Viewer): Promise<ScenarioFormOptions> {
  await connectDB();
  const [projects, items, vendors, equipment, employees] = await Promise.all([
    Project.find({}, { name: 1, code: 1, client: 1, status: 1, color: 1, budget: 1, stageBudgets: 1 }).sort({ name: 1 }).lean(),
    InventoryItem.find({ archivedAt: null }, { name: 1, sku: 1, unit: 1, available: 1, unitPrice: 1, lastPurchasePrice: 1 }).sort({ name: 1 }).lean(),
    getVendorNames(),
    loadEquipment(),
    Employee.find({ status: "active" }, { department: 1, monthlySalary: 1, skills: 1 }).lean(),
  ]);
  const skills = [...new Set(employees.flatMap((e) => e.skills ?? []).map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    projects: projects.map((p) => ({
      value: String(p._id),
      label: p.name,
      description: [p.code, p.client].filter(Boolean).join(" · "),
      status: p.status,
      color: p.color ?? "#4a82cc",
      budget: p.budget ?? 0,
      stageBudgets: { ...((p.stageBudgets as Record<string, number> | undefined) ?? {}) },
    })),
    items: items.map((i) => {
      const available = roundQty(i.available ?? 0);
      return {
        value: String(i._id),
        label: i.name,
        description: `${i.sku} · ${available} ${i.unit ?? "pcs"} available`,
        unit: i.unit ?? "pcs",
        available,
        averageCost: i.unitPrice ?? 0,
        lastPurchasePrice: typeof i.lastPurchasePrice === "number" ? i.lastPurchasePrice : null,
      };
    }),
    vendors,
    equipment: equipment.map((e) => ({
      value: e.id,
      label: e.name,
      description: [e.code, `${e.quantity} unit${e.quantity === 1 ? "" : "s"}`, e.projectName ? `with ${e.projectName}` : null].filter(Boolean).join(" · "),
      quantity: e.quantity,
    })),
    departments: DEPARTMENTS.map((d) => {
      const people = employees.filter((e) => e.department === d.value);
      const paid = people.map((e) => e.monthlySalary ?? 0).filter((n) => n > 0);
      return {
        value: d.value,
        label: d.label,
        active: people.length,
        averageSalary: viewer.admin && paid.length ? round2(paid.reduce((s, n) => s + n, 0) / paid.length) : null,
      };
    }),
    skills,
  };
}

/* History across all scenarios */

export async function listHistory(params: ListParams): Promise<Paginated<HistoryRow>> {
  await connectDB();
  const pre: Record<string, unknown> = {};
  if (params.filters.type?.length) pre.type = { $in: params.filters.type };
  if (params.filters.scenario?.length) pre._id = { $in: params.filters.scenario.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
  const post: Record<string, unknown> = {};
  if (params.filters.action?.length) post["history.action"] = { $in: params.filters.action };
  if (params.filters.status?.length) post["history.status"] = { $in: params.filters.status };
  if (params.filters.user?.length) post["history.byName"] = { $in: params.filters.user };
  const range = dateRangeFilter(params.from, params.to);
  if (range) post["history.at"] = range;
  if (params.q) {
    const re = searchRegex(params.q);
    post.$or = [{ name: re }, { code: re }, { "history.changes": re }, { "history.note": re }];
  }
  const pipeline: PipelineStage[] = [
    { $match: pre },
    { $project: { code: 1, name: 1, type: 1, status: 1, history: 1 } },
    { $unwind: { path: "$history", includeArrayIndex: "index" } },
    { $match: post },
  ];
  const [rows, count] = await Promise.all([
    Scenario.aggregate<{ _id: Types.ObjectId; code: string; name: string; type: ScenarioType; status: ScenarioStatus; index: number; history: Lean["history"][number] }>([
      ...pipeline,
      { $sort: { "history.at": params.sort?.desc === false ? 1 : -1, _id: -1, index: -1 } },
      { $skip: (params.page - 1) * params.pageSize },
      { $limit: params.pageSize },
    ]),
    Scenario.aggregate<{ n: number }>([...pipeline, { $count: "n" }]),
  ]);
  return {
    rows: rows.map((r) => ({
      key: `${r._id}-${r.index}`,
      at: new Date(r.history.at).toISOString(),
      byName: r.history.byName ?? null,
      action: r.history.action,
      changes: r.history.changes ?? [],
      status: (r.history.status ?? null) as ScenarioStatus | null,
      note: r.history.note ?? null,
      scenario: { id: String(r._id), code: r.code, name: r.name, type: r.type, status: r.status ?? "draft" },
    })),
    total: count[0]?.n ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** Names of people in the history, for the filter. */
export async function getHistoryUsers(): Promise<string[]> {
  await connectDB();
  const names = (await Scenario.distinct("history.byName")) as (string | null)[];
  return names.filter((n): n is string => Boolean(n)).sort((a, b) => a.localeCompare(b));
}

/** Every scenario, newest first, for the comparison picker. */
export async function getScenarioChoices(): Promise<{ value: string; label: string; description: string; type: ScenarioType }[]> {
  await connectDB();
  const docs = await Scenario.find({}, { code: 1, name: 1, type: 1, status: 1 }).sort({ updatedAt: -1 }).limit(500).lean();
  return docs.map((d) => ({ value: String(d._id), label: d.name, description: d.code, type: d.type as ScenarioType }));
}

/* Comparison */

export async function businessPosition(viewer: Viewer): Promise<BusinessPosition> {
  await connectDB();
  const [usage, people, cash] = await Promise.all([
    budgetUsage({ status: ["planning", "active", "on_hold"] }, { includeSalaries: viewer.admin }),
    loadPeople(viewer),
    viewer.admin ? loadCash() : Promise.resolve(null),
  ]);
  const capacity = departmentCapacity(people.employees, people.memberships);
  return {
    budgets: round2(usage.reduce((s, p) => s + p.budget, 0)),
    spent: round2(usage.reduce((s, p) => s + p.spent, 0)),
    activePeople: people.employees.length,
    freeFte: round2([...capacity.values()].reduce((s, d) => s + d.free, 0)),
    cash: cash?.total ?? null,
  };
}

export async function getComparison(ids: string[], basis: "saved" | "today", viewer: Viewer): Promise<{ position: BusinessPosition; columns: CompareColumn[]; rows: CompareRow[] }> {
  await connectDB();
  const valid = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).slice(0, 8);
  const docs = valid.length ? await Scenario.find({ _id: { $in: valid.map((id) => new Types.ObjectId(id)) } }).lean<Lean[]>() : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const [position, columns] = await Promise.all([
    businessPosition(viewer),
    Promise.all(
      valid.flatMap((id) => {
        const doc = byId.get(id);
        if (!doc) return [];
        return [
          (async (): Promise<CompareColumn> => {
            const base = { id, code: doc.code, name: doc.name, type: doc.type as ScenarioType, status: (doc.status ?? "draft") as ScenarioStatus, savedAt: doc.computedAt ? new Date(doc.computedAt).toISOString() : null };
            if (basis === "saved") {
              const saved = savedVisible((doc.results ?? null) as ScenarioResults | null, viewer);
              if (saved.results) return { ...base, basis: "saved", results: saved.results, error: null };
            }
            const live = await liveResults(parseSpec(doc.type, doc.inputs), viewer);
            return { ...base, basis: "today", results: live.results, error: live.error };
          })(),
        ];
      }),
    ),
  ]);
  return { position, columns, rows: compareMatrix(position, columns) };
}
