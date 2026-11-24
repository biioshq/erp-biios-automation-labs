import "server-only";

import { connectDB } from "@/server/db";
import { InventoryMovement } from "@/server/models";
import { DEPARTMENTS, labelOf, type Department } from "@/lib/constants";
import { monthKeyIST, startOfMonthIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { AnalyticsRange } from "./params";
import { NOT_OPENING_ON_HAND } from "@/lib/inventory-opening";
import { itemNames, loadMovements, projectNames, round3, type MovementFact } from "./data";

/**
 * Stock movement analysis (4.1): what came in, went out, came back, moved and was written off in
 * a period, from the inventory ledger's movements. Values are what the ledger recorded on each
 * movement (totalCost), so they agree with the item histories. Units are only added up per
 * material: different items are counted in different units.
 */

export type Flow = { count: number; value: number };

export type MovementTotals = {
  /** Purchases, without opening stock entered as already on hand. */
  received: Flow;
  /** Opening stock entered as already on hand (not bought in the period). */
  opening: Flow;
  issued: Flow;
  returned: Flow;
  /** Of issued and returned: moves between projects (a return from one, an assignment to the other). */
  moved: Flow;
  relocations: { count: number };
  adjustedUp: Flow;
  adjustedDown: Flow;
  wastedStorage: Flow;
  wastedProject: Flow;
  /** Issued minus returned, at the value recorded on each movement. */
  netIssued: number;
};

export type MonthFlow = { month: string; received: number; issued: number; returned: number; wasted: number };
export type YearFlow = { label: string; startYear: number; received: number; issued: number; returned: number; wasted: number; count: number };

export type ProjectConsumption = {
  projectId: string;
  name: string;
  code: string;
  color: string;
  issues: number;
  issued: number;
  returned: number;
  net: number;
  wasted: number;
  items: number;
};

export type DepartmentWastage = { department: Department | null; label: string; count: number; value: number };

export type MaterialMovement = {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  archived: boolean;
  received: number;
  /** Opening stock entered as already on hand. */
  opening: number;
  issued: number;
  returned: number;
  wasted: number;
  /** Signed net of manual adjustments. */
  adjusted: number;
  relocations: number;
  movements: number;
  netIssuedValue: number;
  lastDay: string;
};

export type HistoryRow = {
  id: string;
  day: string;
  type: MovementFact["type"];
  quantity: number;
  availableDelta: number;
  value: number;
  project: { id: string; name: string } | null;
  moveHalf: boolean;
  openingOnHand: boolean;
  wastageFrom: MovementFact["wastageFrom"];
  balanceAvailable: number | null;
  note: string | null;
};

export type MovementAnalysis = {
  totals: MovementTotals;
  monthly: MonthFlow[];
  monthlyTrimmed: boolean;
  yearly: YearFlow[];
  projects: ProjectConsumption[];
  departments: DepartmentWastage[];
  materials: MaterialMovement[];
  count: number;
  history: { item: { id: string; name: string; sku: string; unit: string }; rows: HistoryRow[] } | null;
};

const flow = (): Flow => ({ count: 0, value: 0 });
const add = (f: Flow, value: number) => {
  f.count += 1;
  f.value = round2(f.value + value);
};

function totalsOf(rows: MovementFact[]): MovementTotals {
  const t: MovementTotals = {
    received: flow(),
    opening: flow(),
    issued: flow(),
    returned: flow(),
    moved: flow(),
    relocations: { count: 0 },
    adjustedUp: flow(),
    adjustedDown: flow(),
    wastedStorage: flow(),
    wastedProject: flow(),
    netIssued: 0,
  };
  for (const m of rows) {
    if (m.type === "purchase") add(m.openingOnHand ? t.opening : t.received, m.totalCost);
    else if (m.type === "assign") add(t.issued, m.totalCost);
    else if (m.type === "return") {
      add(t.returned, m.totalCost);
      if (m.moveHalf) add(t.moved, m.totalCost);
    } else if (m.type === "transfer") t.relocations.count += 1;
    else if (m.type === "adjustment") add(m.availableDelta >= 0 ? t.adjustedUp : t.adjustedDown, m.totalCost);
    else if (m.type === "wastage") add(m.wastageFrom === "project" ? t.wastedProject : t.wastedStorage, m.totalCost);
  }
  t.netIssued = round2(t.issued.value - t.returned.value);
  return t;
}

const MAX_MONTHS = 36;

/** Month by month inside the range, zero-filled; only the latest 36 months when longer. */
function monthlyOf(rows: MovementFact[], range: AnalyticsRange): { months: MonthFlow[]; trimmed: boolean } {
  const keys: string[] = [];
  for (let d = startOfMonthIST(range.start); d.getTime() <= range.end.getTime(); d = startOfMonthIST(d, 1)) keys.push(monthKeyIST(d));
  const trimmed = keys.length > MAX_MONTHS;
  const shown = trimmed ? keys.slice(-MAX_MONTHS) : keys;
  const by = new Map(shown.map((k) => [k, { month: k, received: 0, issued: 0, returned: 0, wasted: 0 }]));
  for (const m of rows) {
    const row = by.get(m.day.slice(0, 7));
    if (!row) continue;
    if (m.type === "purchase") {
      if (!m.openingOnHand) row.received = round2(row.received + m.totalCost);
    } else if (m.type === "assign") row.issued = round2(row.issued + m.totalCost);
    else if (m.type === "return") row.returned = round2(row.returned + m.totalCost);
    else if (m.type === "wastage") row.wasted = round2(row.wasted + m.totalCost);
  }
  return { months: [...by.values()], trimmed };
}

/** Indian financial years over every movement ever recorded (not limited by the range). */
async function yearlyFlows(): Promise<YearFlow[]> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: { month: string; type: string }; value: number; n: number }>([
    // Opening stock entered as already on hand was not bought then, so it is not a receipt.
    { $match: { type: { $in: ["purchase", "assign", "return", "wastage"] }, ...NOT_OPENING_ON_HAND } },
    {
      $group: {
        _id: { month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } }, type: "$type" },
        value: { $sum: { $ifNull: ["$totalCost", 0] } },
        n: { $sum: 1 },
      },
    },
  ]);
  const years = new Map<number, YearFlow>();
  for (const r of rows) {
    const [y, m] = r._id.month.split("-").map(Number);
    const startYear = m >= 4 ? y : y - 1;
    const row = years.get(startYear) ?? {
      label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
      startYear,
      received: 0,
      issued: 0,
      returned: 0,
      wasted: 0,
      count: 0,
    };
    const v = r.value;
    if (r._id.type === "purchase") row.received = round2(row.received + v);
    else if (r._id.type === "assign") row.issued = round2(row.issued + v);
    else if (r._id.type === "return") row.returned = round2(row.returned + v);
    else row.wasted = round2(row.wasted + v);
    row.count += r.n;
    years.set(startYear, row);
  }
  return [...years.values()].sort((a, b) => b.startYear - a.startYear);
}

function projectsOf(rows: MovementFact[], names: Awaited<ReturnType<typeof projectNames>>): ProjectConsumption[] {
  const out = new Map<string, ProjectConsumption & { itemSet: Set<string> }>();
  for (const m of rows) {
    if (!m.project || !["assign", "return", "wastage"].includes(m.type)) continue;
    const p = names.get(m.project);
    const row =
      out.get(m.project) ??
      {
        projectId: m.project,
        name: p?.name ?? "Deleted project",
        code: p?.code ?? "",
        color: p?.color ?? "#94a3b8",
        issues: 0,
        issued: 0,
        returned: 0,
        net: 0,
        wasted: 0,
        items: 0,
        itemSet: new Set<string>(),
      };
    if (m.type === "assign") {
      row.issues += 1;
      row.issued = round2(row.issued + m.totalCost);
      row.itemSet.add(m.item);
    } else if (m.type === "return") row.returned = round2(row.returned + m.totalCost);
    else row.wasted = round2(row.wasted + m.totalCost);
    out.set(m.project, row);
  }
  return [...out.values()]
    .map(({ itemSet, ...r }) => ({ ...r, net: round2(r.issued - r.returned), items: itemSet.size }))
    .sort((a, b) => b.net - a.net);
}

function departmentsOf(rows: MovementFact[]): DepartmentWastage[] {
  const out = new Map<string, DepartmentWastage>();
  for (const m of rows) {
    if (m.type !== "wastage") continue;
    const key = m.department ?? "";
    const row = out.get(key) ?? { department: m.department, label: m.department ? labelOf(DEPARTMENTS, m.department) : "Department not given", count: 0, value: 0 };
    row.count += 1;
    row.value = round2(row.value + m.totalCost);
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => b.value - a.value);
}

function materialsOf(rows: MovementFact[], names: Awaited<ReturnType<typeof itemNames>>): MaterialMovement[] {
  const out = new Map<string, MaterialMovement>();
  for (const m of rows) {
    const it = names.get(m.item);
    const row =
      out.get(m.item) ??
      {
        itemId: m.item,
        name: it?.name ?? "Deleted item",
        sku: it?.sku ?? "",
        unit: it?.unit ?? "pcs",
        archived: it?.archived ?? false,
        received: 0,
        opening: 0,
        issued: 0,
        returned: 0,
        wasted: 0,
        adjusted: 0,
        relocations: 0,
        movements: 0,
        netIssuedValue: 0,
        lastDay: m.day,
      };
    row.movements += 1;
    row.lastDay = m.day > row.lastDay ? m.day : row.lastDay;
    if (m.type === "purchase") {
      if (m.openingOnHand) row.opening = round3(row.opening + m.quantity);
      else row.received = round3(row.received + m.quantity);
    } else if (m.type === "assign") {
      row.issued = round3(row.issued + m.quantity);
      row.netIssuedValue = round2(row.netIssuedValue + m.totalCost);
    } else if (m.type === "return") {
      row.returned = round3(row.returned + m.quantity);
      row.netIssuedValue = round2(row.netIssuedValue - m.totalCost);
    } else if (m.type === "wastage") row.wasted = round3(row.wasted + m.quantity);
    else if (m.type === "adjustment") row.adjusted = round3(row.adjusted + m.availableDelta);
    else if (m.type === "transfer") row.relocations += 1;
    out.set(m.item, row);
  }
  return [...out.values()].sort((a, b) => b.movements - a.movements || a.name.localeCompare(b.name));
}

/** Everything the movement analysis page shows for one range, and one item's history when asked. */
export async function getMovementAnalysis(range: AnalyticsRange, historyItemId: string | null): Promise<MovementAnalysis> {
  const [rows, items, projects, yearly] = await Promise.all([loadMovements(range.start, range.end), itemNames(), projectNames(), yearlyFlows()]);
  const { months, trimmed } = monthlyOf(rows, range);
  let history: MovementAnalysis["history"] = null;
  const it = historyItemId ? items.get(historyItemId) : undefined;
  if (it) {
    history = {
      item: { id: it.id, name: it.name, sku: it.sku, unit: it.unit },
      rows: rows
        .filter((m) => m.item === it.id)
        .reverse()
        .map((m) => ({
          id: m.id,
          day: m.day,
          type: m.type,
          quantity: m.quantity,
          availableDelta: m.availableDelta,
          value: m.totalCost,
          project: m.project ? { id: m.project, name: projects.get(m.project)?.name ?? "Deleted project" } : null,
          moveHalf: m.moveHalf,
          openingOnHand: m.openingOnHand,
          wastageFrom: m.wastageFrom,
          balanceAvailable: m.balanceAvailable,
          note: m.note,
        })),
    };
  }
  return {
    totals: totalsOf(rows),
    monthly: months,
    monthlyTrimmed: trimmed,
    yearly,
    projects: projectsOf(rows, projects),
    departments: departmentsOf(rows),
    materials: materialsOf(rows, items),
    count: rows.length,
    history,
  };
}
