import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, FixedAsset, Project } from "@/server/models";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { addDays, fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import type { AssetCondition } from "@/lib/constants";
import { WARRANTY_SOON_DAYS } from "../constants";
import type { EquipmentRow, MaintenanceEntry } from "../types";

/**
 * Equipment maintenance outlook from the fixed asset register. Next service is the due date
 * recorded on the latest maintenance entry, or, without one, the last service plus the average
 * gap between at least two recorded services. Usage hours are not recorded, so nothing here
 * depends on them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Fixed asset groups counted as equipment, with every subgroup admins add under them. */
export const EQUIPMENT_GROUPS = ["plant_machinery", "computers_electronics", "vehicles"] as const;

type Entry = { date: Date; description: string; cost?: number | null; vendor?: string | null; nextDueDate?: Date | null; expense?: Types.ObjectId | null };

const daysFrom = (today: Date, day: Date) => Math.round((startOfDayIST(day).getTime() - today.getTime()) / DAY_MS);

type NextService = Pick<EquipmentRow, "nextDue" | "nextBasis" | "intervalDays" | "nextNote">;

/** Next expected service from the recorded entries (oldest first). */
function nextService(entries: Entry[]): NextService {
  const last = entries.at(-1);
  if (last?.nextDueDate) return { nextDue: toDateInput(last.nextDueDate), nextBasis: "recorded", intervalDays: null, nextNote: null };
  const days = [...new Set(entries.map((e) => toDateInput(e.date)))];
  if (days.length < 2) {
    return {
      nextDue: null,
      nextBasis: null,
      intervalDays: null,
      nextNote: days.length === 0 ? "No maintenance recorded yet" : "Not enough maintenance history: one service recorded, two are needed for an interval",
    };
  }
  const stamps = days.map((d) => fromDateInput(d).getTime());
  const gaps = stamps.slice(1).map((t, i) => (t - stamps[i]) / DAY_MS);
  const interval = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
  return { nextDue: toDateInput(addDays(new Date(stamps.at(-1)!), interval)), nextBasis: "interval", intervalDays: interval, nextNote: null };
}

function attentionFor(condition: AssetCondition, dueIn: number | null, warrantyUntil: Date | null, today: Date): string[] {
  const out: string[] = [];
  if (dueIn !== null && dueIn < 0) out.push(`Service overdue by ${-dueIn} ${dueIn === -1 ? "day" : "days"}`);
  if (condition === "damaged") out.push("Marked damaged");
  if (condition === "under_maintenance") out.push("Under maintenance now");
  if (warrantyUntil) {
    const left = daysFrom(today, warrantyUntil);
    if (left >= 0 && left <= WARRANTY_SOON_DAYS) out.push(`Warranty ends on ${formatDate(warrantyUntil)}`);
  }
  return out;
}

export async function equipmentOutlook(now: Date = new Date()): Promise<EquipmentRow[]> {
  await connectDB();
  const today = startOfDayIST(now);
  const groups = await loadFinanceGroups("asset", { includeArchived: true });
  const equipmentKeys = [...new Set(EQUIPMENT_GROUPS.flatMap((root) => descendantsOf(groups, root)))];
  const labelOf = new Map(groups.map((g) => [g.key, g.label]));
  const assets = await FixedAsset.find(
    {
      archivedAt: null,
      disposal: null,
      condition: { $nin: ["disposed", "lost"] },
      kind: "tangible",
      $or: [{ isEquipment: true }, { group: { $in: equipmentKeys } }],
    },
    { code: 1, name: 1, group: 1, condition: 1, location: 1, project: 1, maintenance: 1, warrantyUntil: 1 },
  )
    .sort({ name: 1 })
    .lean();
  if (!assets.length) return [];

  const expenseIds = assets.flatMap((a) => (a.maintenance ?? []).map((m) => m.expense).filter((e): e is Types.ObjectId => Boolean(e)));
  const projectIds = assets.map((a) => a.project).filter((p): p is Types.ObjectId => Boolean(p));
  const [expenses, projects] = await Promise.all([
    expenseIds.length ? Expense.find({ _id: { $in: expenseIds } }, { amount: 1 }).lean() : Promise.resolve([]),
    projectIds.length ? Project.find({ _id: { $in: projectIds } }, { name: 1 }).lean() : Promise.resolve([]),
  ]);
  const expenseAmount = new Map(expenses.map((e) => [String(e._id), e.amount]));
  const projectName = new Map(projects.map((p) => [String(p._id), p.name]));

  return assets.map((a) => {
    const entries: Entry[] = [...(a.maintenance ?? [])].sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
    // A booked cost is the expense's amount, as the register records it.
    const costOf = (e: Entry) => (e.expense && expenseAmount.has(String(e.expense)) ? (expenseAmount.get(String(e.expense)) ?? 0) : (e.cost ?? 0));
    const history: MaintenanceEntry[] = entries
      .map((e) => ({
        date: toDateInput(e.date),
        description: e.description,
        cost: round2(costOf(e)),
        vendor: e.vendor ?? null,
        nextDueDate: e.nextDueDate ? toDateInput(e.nextDueDate) : null,
      }))
      .reverse();
    const costs = history.map((h) => h.cost).filter((c) => c > 0);
    const next = nextService(entries);
    const dueIn = next.nextDue ? daysFrom(today, fromDateInput(next.nextDue)) : null;
    const condition = (a.condition ?? "good") as AssetCondition;
    return {
      id: String(a._id),
      code: a.code,
      name: a.name,
      groupLabel: labelOf.get(a.group) ?? a.group,
      condition,
      location: a.location ?? null,
      projectName: a.project ? (projectName.get(String(a.project)) ?? null) : null,
      lastMaintenance: history[0]?.date ?? null,
      history,
      ...next,
      dueIn,
      attention: attentionFor(condition, dueIn, a.warrantyUntil ?? null, today),
      averageCost: costs.length ? round2(costs.reduce((s, c) => s + c, 0) / costs.length) : null,
      costEntries: costs.length,
      warrantyUntil: a.warrantyUntil ? toDateInput(a.warrantyUntil) : null,
    };
  });
}
