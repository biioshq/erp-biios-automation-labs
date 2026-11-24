import "server-only";

import { connectDB } from "@/server/db";
import { InventoryMovement } from "@/server/models";
import { balanceSheet, positionSummary } from "@/server/accounting/statements";
import { effectiveAsOf } from "@/server/accounting/ledger";
import { financialYearIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { StatementLine } from "@/lib/accounting";

export type WastageTotals = { allTime: number; year: number; yearLabel: string; count: number };

/** Value of every wastage movement (cost of the units written off), all time and this financial year. */
export async function wastageTotals(now: Date = new Date()): Promise<WastageTotals> {
  await connectDB();
  const fy = financialYearIST(now);
  const asOf = effectiveAsOf(now);
  const [row] = await InventoryMovement.aggregate<{ allTime: number; year: number; count: number }>([
    { $match: { type: "wastage", date: { $lte: asOf } } },
    {
      $group: {
        _id: null,
        allTime: { $sum: { $ifNull: ["$totalCost", 0] } },
        year: { $sum: { $cond: [{ $gte: ["$date", fy.start] }, { $ifNull: ["$totalCost", 0] }, 0] } },
        count: { $sum: 1 },
      },
    },
  ]);
  return { allTime: round2(row?.allTime ?? 0), year: round2(row?.year ?? 0), yearLabel: fy.label, count: row?.count ?? 0 };
}

export type AssetsOverview = {
  asOf: string;
  totalAssets: number;
  currentAssets: number;
  nonCurrentAssets: number;
  inventory: number;
  fixedAssets: number;
  investments: number;
  cash: number;
  receivables: number;
  current: StatementLine[];
  nonCurrent: StatementLine[];
  wastage: WastageTotals;
};

/** The assets side of the balance sheet as of today, plus wastage written off. */
export async function getAssetsOverview(): Promise<AssetsOverview> {
  const [summary, sheet, wastage] = await Promise.all([positionSummary(), balanceSheet(), wastageTotals()]);
  return {
    asOf: summary.asOf,
    totalAssets: summary.totalAssets,
    currentAssets: summary.currentAssets,
    nonCurrentAssets: summary.nonCurrentAssets,
    inventory: summary.inventory,
    fixedAssets: summary.fixedAssets,
    investments: summary.investments,
    cash: summary.cash,
    receivables: summary.receivables,
    current: sheet.assets.current,
    nonCurrent: sheet.assets.nonCurrent,
    wastage,
  };
}
