import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, ForecastSnapshot } from "@/server/models";
import { usageByItem } from "@/server/analytics/core";
import { addDays, endOfDayIST, fromDateInput, monthKeyIST, startOfDayIST, toDateInput } from "@/lib/dates";
import { formatCurrency, formatDate, formatNumber, round2 } from "@/lib/format";
import { MIN_HISTORY_DAYS, SNAPSHOT_HORIZON_DAYS } from "../constants";
import { resolveWindow } from "../params";
import type { AccuracyByKey, AccuracyByMonth, AccuracyRow } from "../types";
import { demandForecast } from "./demand";
import { projectCostForecast } from "./projects";

/**
 * Forecasts kept so they can be checked later (Forecast vs actual). Each month the standard
 * forecast is stored once per item and per project: the default 90-day window with no filters,
 * and project spend with salaries included, whoever opens the page. A stored forecast is never
 * changed: writes only insert rows that are missing ($setOnInsert on the unique kind+key+month).
 *
 *  - material_demand: units expected to be used in the 30 days from the day it was stored
 *  - project_cost: the predicted total cost, checked against recorded spend at the planned end
 */

type Kind = "material_demand" | "project_cost";
type SnapshotInput = { kind: Kind; key: string; label: string; from: Date; to: Date; predicted: number; unit?: string; basis: string };

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

async function materialSnapshots(now: Date): Promise<SnapshotInput[]> {
  const window = resolveWindow({}, now);
  const { rows } = await demandForecast(window, undefined, now);
  const from = startOfDayIST(now);
  const to = endOfDayIST(addDays(from, SNAPSHOT_HORIZON_DAYS - 1));
  return rows
    .filter((r) => r.status === "forecast" && r.perDay && r.predicted)
    .map((r) => ({
      kind: "material_demand" as const,
      key: r.id,
      label: `${r.name} (${r.sku})`,
      from,
      to,
      predicted: round3(r.predicted![SNAPSHOT_HORIZON_DAYS]),
      unit: r.unit,
      basis: `${formatNumber(round3(r.perDay!))} ${r.unit} a day, the use in the ${window.days}-day window to ${formatDate(fromDateInput(window.to))} spread over the ${r.rateDays ?? window.days} days from its first use in it (at least ${MIN_HISTORY_DAYS}), for ${SNAPSHOT_HORIZON_DAYS} days`,
    }))
    // A forecast that rounds to nothing cannot be scored against anything.
    .filter((s) => s.predicted > 0);
}

async function projectSnapshots(now: Date): Promise<SnapshotInput[]> {
  const rows = await projectCostForecast({ includeSalaries: true, now });
  const from = startOfDayIST(now);
  // Only run-rate predictions with a planned end still ahead: that is the day the forecast is
  // checked. Spend to date and projects without a figure are not predictions, so nothing is stored.
  return rows
    .filter((r) => r.method === "run_rate" && r.predictedTotal !== null && r.predictedTotal > 0 && r.endDate && fromDateInput(r.endDate) > from)
    .map((r) => ({
      kind: "project_cost" as const,
      key: r.id,
      label: `${r.name} (${r.code})`,
      from,
      to: endOfDayIST(fromDateInput(r.endDate!)),
      predicted: r.predictedTotal!,
      basis: `${formatCurrency(r.spent)} spent over ${r.daysElapsed} days, continued at that rate for the ${r.daysRemaining} days to the planned end`,
    }));
}

/** Inserts the snapshots this month does not have yet. Returns how many were added. */
async function insertMissing(inputs: SnapshotInput[], month: string): Promise<number> {
  if (!inputs.length) return 0;
  const result = await ForecastSnapshot.bulkWrite(
    inputs.map((s) => ({
      updateOne: {
        filter: { kind: s.kind, key: s.key, month },
        update: { $setOnInsert: { ...s, month, createdAt: new Date(), updatedAt: new Date() } },
        upsert: true,
        // Existing rows are left exactly as stored, timestamps included.
        timestamps: false,
      },
    })),
    { ordered: false },
  );
  return result.upsertedCount;
}

export type SaveResult = { month: string; materials: number; projects: number };

/** Stores this month's missing forecasts (both kinds). Safe to run any number of times. */
export async function saveMonthForecast(now: Date = new Date()): Promise<SaveResult> {
  await connectDB();
  const month = monthKeyIST(now);
  const [materials, projects] = await Promise.all([materialSnapshots(now), projectSnapshots(now)]);
  const [m, p] = await Promise.all([insertMissing(materials, month), insertMissing(projects, month)]);
  return { month, materials: m, projects: p };
}

/**
 * Called when the demand or project cost page is viewed: stores the month's forecast of that kind
 * the first time in a month. A failure is logged, never shown: viewing a page must not fail on it.
 */
export async function ensureMonthSnapshot(kind: Kind, now: Date = new Date()): Promise<void> {
  try {
    await connectDB();
    const month = monthKeyIST(now);
    if (await ForecastSnapshot.exists({ kind, month })) return;
    const inputs = kind === "material_demand" ? await materialSnapshots(now) : await projectSnapshots(now);
    await insertMissing(inputs, month);
  } catch (error) {
    console.error("[forecasting] could not store this month's forecast", error);
  }
}

/** Recorded spend of each project up to `to`, matched as projectSpend matches it (salaries included). */
async function spendUpTo(projectIds: string[], to: Date): Promise<Map<string, number>> {
  const rows = await Expense.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { project: { $in: projectIds.map((id) => new Types.ObjectId(id)) }, date: { $lte: to } } },
    { $group: { _id: "$project", total: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), round2(r.total)]));
}

export type AccuracyReport = {
  rows: AccuracyRow[];
  byMonth: AccuracyByMonth[];
  byKey: AccuracyByKey[];
  /** Stored forecasts whose period has not ended yet. */
  pending: { material: number; project: number; nextCheck: string | null };
  stored: number;
  firstMonth: string | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

type Stored = { _id: Types.ObjectId; kind: string; key: string; label?: string | null; month: string; from: Date; to: Date; predicted: number; unit?: string | null; basis?: string | null };

function compare(s: Stored, actual: number): AccuracyRow {
  const difference = s.kind === "project_cost" ? round2(actual - s.predicted) : round3(actual - s.predicted);
  const deviation = s.predicted > 0 ? difference / s.predicted : 0;
  return {
    id: String(s._id),
    kind: s.kind as Kind,
    key: s.key,
    label: s.label ?? s.key,
    month: s.month,
    from: toDateInput(s.from),
    to: toDateInput(s.to),
    unit: s.unit ?? null,
    basis: s.basis ?? null,
    predicted: s.predicted,
    actual,
    difference,
    deviation,
    accuracy: Math.max(0, 1 - Math.abs(deviation)),
  };
}

/**
 * Stored forecasts whose period has ended, against what happened: units used in the same 30 days
 * (the shared usage measure), or project spend recorded up to the planned end date.
 */
export async function accuracyReport(options: { includeProjects: boolean; now?: Date }): Promise<AccuracyReport> {
  await connectDB();
  const now = options.now ?? new Date();
  const kinds: Kind[] = options.includeProjects ? ["material_demand", "project_cost"] : ["material_demand"];
  const all = await ForecastSnapshot.find({ kind: { $in: kinds } }).sort({ month: 1, label: 1 }).lean();
  const due = all.filter((s) => s.to < now);
  const pendingRows = all.filter((s) => s.to >= now);

  // One usage read per distinct period end (snapshots stored the same day share one).
  const rows: AccuracyRow[] = [];
  const byEnd = new Map<number, typeof due>();
  for (const s of due) byEnd.set(s.to.getTime(), [...(byEnd.get(s.to.getTime()) ?? []), s]);
  for (const [end, group] of byEnd) {
    const materials = group.filter((s) => s.kind === "material_demand");
    const projects = group.filter((s) => s.kind === "project_cost");
    const [usage, spend] = await Promise.all([
      materials.length ? usageByItem(SNAPSHOT_HORIZON_DAYS, new Date(end), materials.map((s) => s.key)) : Promise.resolve(null),
      projects.length ? spendUpTo(projects.map((s) => s.key), new Date(end)) : Promise.resolve(null),
    ]);
    for (const s of materials) rows.push(compare(s, usage?.get(s.key)?.consumed ?? 0));
    for (const s of projects) rows.push(compare(s, spend?.get(s.key) ?? 0));
  }

  const months = [...new Set(rows.map((r) => r.month))].sort();
  const byMonth: AccuracyByMonth[] = months.map((month) => {
    const m = rows.filter((r) => r.month === month && r.kind === "material_demand").map((r) => r.accuracy);
    const p = rows.filter((r) => r.month === month && r.kind === "project_cost").map((r) => r.accuracy);
    return { month, material: mean(m), materialCount: m.length, project: mean(p), projectCount: p.length };
  });

  const keyMap = new Map<string, AccuracyRow[]>();
  for (const r of rows) keyMap.set(`${r.kind}:${r.key}`, [...(keyMap.get(`${r.kind}:${r.key}`) ?? []), r]);
  const byKey: AccuracyByKey[] = [...keyMap.values()]
    .map((list) => ({
      kind: list[0].kind,
      key: list[0].key,
      label: list.at(-1)!.label,
      unit: list[0].unit,
      comparisons: list.length,
      predicted: list[0].kind === "project_cost" ? round2(list.reduce((s, r) => s + r.predicted, 0)) : round3(list.reduce((s, r) => s + r.predicted, 0)),
      actual: list[0].kind === "project_cost" ? round2(list.reduce((s, r) => s + r.actual, 0)) : round3(list.reduce((s, r) => s + r.actual, 0)),
      accuracy: mean(list.map((r) => r.accuracy)) ?? 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || a.label.localeCompare(b.label));

  const nextCheck = pendingRows.reduce<Date | null>((m, s) => (!m || s.to < m ? s.to : m), null);
  return {
    rows: rows.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)),
    byMonth,
    byKey,
    pending: {
      material: pendingRows.filter((s) => s.kind === "material_demand").length,
      project: pendingRows.filter((s) => s.kind === "project_cost").length,
      nextCheck: nextCheck ? toDateInput(nextCheck) : null,
    },
    stored: all.length,
    firstMonth: all[0]?.month ?? null,
  };
}
