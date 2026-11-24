import "server-only";

import { connectDB } from "@/server/db";
import { InventoryAllocation, InventoryItem } from "@/server/models";
import { accountHistory } from "@/server/accounting/statements";
import { effectiveAsOf } from "@/server/accounting/ledger";
import { inventorySnapshot } from "@/server/services/metrics";
import { returnableOf, roundQty } from "@/server/services/inventory-ledger";
import { addDays, financialYearIST, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { wastageToDate } from "@/features/inventory/wastage/queries";
import type { StockPeriodKey, StockPosition, StockRollForward } from "./types";

export const STOCK_PERIODS: { value: StockPeriodKey; label: string }[] = [
  { value: "fy", label: "This financial year" },
  { value: "last-fy", label: "Last financial year" },
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
];

/** Day bounds of a period key, in IST. The end never passes today: the books stop there. */
export function stockPeriod(key: StockPeriodKey, now: Date = new Date()): { from: Date; to: Date } {
  const today = effectiveAsOf(null);
  switch (key) {
    case "last-fy": {
      const fy = financialYearIST(addDays(financialYearIST(now).start, -1));
      return { from: fy.start, to: fy.end };
    }
    case "month":
      return { from: startOfMonthIST(now), to: today };
    case "last-month":
      return { from: startOfMonthIST(now, -1), to: new Date(startOfMonthIST(now).getTime() - 1) };
    default:
      return { from: financialYearIST(now).start, to: today };
  }
}

/**
 * Value of stock in use on projects: every open assignment's units not wasted, at the cost it was
 * assigned at. Wasted units stay charged to their project but are no longer in use.
 */
async function stockInUse(): Promise<{ value: number; units: number }> {
  const [allocations, archived] = await Promise.all([
    InventoryAllocation.find({ quantity: { $gt: 0 } }, { item: 1, quantity: 1, quantityWasted: 1, unitCost: 1 }).lean(),
    InventoryItem.find({ archivedAt: { $ne: null } }, { _id: 1 }).lean(),
  ]);
  const skip = new Set(archived.map((i) => String(i._id)));
  let value = 0;
  let units = 0;
  for (const a of allocations) {
    if (skip.has(String(a.item))) continue;
    const inUse = returnableOf(a);
    if (inUse <= 0) continue;
    units = roundQty(units + inUse);
    value = round2(value + round2(inUse * a.unitCost));
  }
  return { value, units };
}

/** Ledger labels of stock movements (src/server/accounting/ledger.ts movementLabel) and the line each feeds. */
const MOVEMENT_LINES: Record<string, keyof Omit<StockRollForward, "from" | "to" | "opening" | "closing">> = {
  "Opening stock on hand": "enteredOnHand",
  "Stock used on a project": "issued",
  "Stock returned from a project": "returned",
  "Stock adjustment": "adjusted",
  "Stock written off": "wasted",
};

/**
 * Opening stock, what came in and went out, and closing stock for a period, read from the books'
 * Inventory account (the same postings as the balance sheet), so the lines always add up to the
 * closing balance and agree with Finance. Stock wasted on a project is not here: it left storage
 * when it was assigned.
 */
export async function stockRollForward(from: Date, to: Date): Promise<StockRollForward> {
  const history = await accountHistory("inventory", from, to);
  const out: StockRollForward = {
    from: toDateInput(from),
    to: toDateInput(to),
    opening: history.opening,
    purchased: 0,
    enteredOnHand: 0,
    issued: 0,
    returned: 0,
    adjusted: 0,
    wasted: 0,
    other: 0,
    closing: history.closing,
  };
  for (const row of history.rows) {
    const line = row.kind === "expense" ? "purchased" : row.kind === "movement" ? (MOVEMENT_LINES[row.label] ?? "other") : "other";
    // Out-going lines are shown as positive amounts that reduce stock.
    const amount = line === "issued" || line === "wasted" ? -row.amount : row.amount;
    out[line] = round2(out[line] + amount);
  }
  return out;
}

/** Stock in storage, in use and wasted, and the period's roll-forward, for the inventory dashboard. */
export async function getStockPosition(key: StockPeriodKey): Promise<StockPosition> {
  await connectDB();
  const period = stockPeriod(key);
  const [snapshot, inUse, wasted, roll] = await Promise.all([inventorySnapshot(), stockInUse(), wastageToDate(), stockRollForward(period.from, period.to)]);
  return {
    period: key,
    storage: { value: snapshot.value, items: snapshot.items },
    inUse,
    wasted: { financialYear: wasted.financialYear, allTime: wasted.allTime, fyLabel: wasted.fyLabel },
    roll,
    today: toDateInput(startOfDayIST()),
  };
}
