import "server-only";

import { connectDB } from "@/server/db";
import { FixedAsset, type FixedAssetDoc } from "@/server/models";
import { loadFinanceGroups } from "@/server/finance-groups";
import { effectiveAsOf } from "@/server/accounting/ledger";
import { periodFromInputs } from "@/server/accounting/statements";
import { bookValue, depreciationBetween } from "@/lib/depreciation";
import { ASSET_CONDITIONS, DEPRECIATION_METHODS, labelOf, type AssetCondition, type DepreciationMethod } from "@/lib/constants";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { col, day, periodText, sumTotals } from "../common";
import { asOfText } from "./statement-rows";
import type { ReportColumn, ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/**
 * The fixed asset register and the depreciation report. Book values and depreciation come from
 * src/lib/depreciation.ts, as on the balance sheet. Like the balance sheet, archived assets still
 * count (archiving hides a record from lists, it does not dispose of it); a disposed asset leaves
 * the register on its disposal date and is listed apart.
 */

type Asset = FixedAssetDoc;

async function groupLabels(): Promise<(key: string) => string> {
  const groups = await loadFinanceGroups("asset", { includeArchived: true });
  const byKey = new Map(groups.map((g) => [g.key, g.label]));
  return (key) => byKey.get(key) ?? key;
}

const disposedBy = (a: Asset, at: Date) => Boolean(a.disposal?.date && a.disposal.date.getTime() <= at.getTime());

/** Rows sorted by group then code, with a subtotal row after each group's assets. */
function withGroupSubtotals(columns: ReportColumn[], rows: (ReportRow & { _group: string })[]): ReportRow[] {
  const out: ReportRow[] = [];
  const groups = [...new Set(rows.map((r) => r._group))];
  for (const g of groups) {
    const inGroup: ReportRow[] = rows.filter((r) => r._group === g).map((r) => {
      const copy: ReportRow = { ...r };
      delete copy._group;
      return copy;
    });
    out.push(...inGroup);
    if (inGroup.length > 1) out.push({ ...sumTotals(columns, inGroup), code: null, name: `${g} total`, _kind: "subtotal" });
  }
  return out;
}

/* Fixed asset register */

const REGISTER_COLUMNS: ReportColumn[] = [
  col("code", "Code", "text", 10),
  col("name", "Asset", "text", 26),
  col("group", "Group", "text", 20),
  col("purchased", "Purchase date", "date", 13),
  col("cost", "Cost", "money", 15),
  col("accumulated", "Accumulated depreciation", "money", 15),
  col("bookValue", "Book value", "money", 15),
  col("location", "Location", "text", 16),
  col("condition", "Condition", "text", 14),
];

const DISPOSED_COLUMNS: ReportColumn[] = [
  col("code", "Code", "text", 10),
  col("name", "Asset", "text", 26),
  col("group", "Group", "text", 20),
  col("purchased", "Purchase date", "date", 13),
  col("disposed", "Disposed on", "date", 13),
  col("cost", "Cost", "money", 15),
  col("accumulated", "Depreciation to disposal", "money", 15),
  col("bookValue", "Book value at disposal", "money", 15),
  col("proceeds", "Proceeds", "money", 15),
  col("result", "Gain or loss", "money", 15),
];

const conditionOf = (a: Asset) => {
  const label = labelOf(ASSET_CONDITIONS, (a.condition ?? "good") as AssetCondition);
  return a.archivedAt ? `${label} (archived)` : label;
};

export async function buildFixedAssetReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const asOf = effectiveAsOf(f.to ? fromDateInput(f.to) : null);
  const [assets, label] = await Promise.all([FixedAsset.find({ purchaseDate: { $lte: asOf } }).lean(), groupLabels()]);
  const sorted = assets.sort((a, b) => label(a.group).localeCompare(label(b.group)) || a.code.localeCompare(b.code));

  const inUse = sorted
    .filter((a) => !disposedBy(a, asOf))
    .map((a) => {
      const v = bookValue(a, asOf);
      return {
        _group: label(a.group),
        code: a.code,
        name: a.name,
        group: label(a.group),
        purchased: day(a.purchaseDate),
        cost: v.cost,
        accumulated: v.accumulated,
        bookValue: v.bookValue,
        location: a.location ?? "",
        condition: conditionOf(a),
      };
    });
  const disposed: ReportRow[] = sorted
    .filter((a) => disposedBy(a, asOf))
    .map((a) => {
      const v = bookValue(a, a.disposal!.date);
      const proceeds = a.disposal?.amount ?? 0;
      return {
        code: a.code,
        name: a.name,
        group: label(a.group),
        purchased: day(a.purchaseDate),
        disposed: day(a.disposal!.date),
        cost: v.cost,
        accumulated: v.accumulated,
        bookValue: v.bookValue,
        proceeds,
        result: round2(proceeds - v.bookValue),
      };
    });

  const rows = withGroupSubtotals(REGISTER_COLUMNS, inUse);
  const totals = sumTotals(REGISTER_COLUMNS, rows);
  const register: ReportSection = { title: "Fixed asset register", columns: REGISTER_COLUMNS, rows, totals };
  const disposedSection: ReportSection = { title: "Disposed assets", columns: DISPOSED_COLUMNS, rows: disposed, totals: sumTotals(DISPOSED_COLUMNS, disposed) };
  return {
    type: "fixed_assets",
    subtitle: `${asOfText(toDateInput(asOf))} · Fixed and intangible assets · Book value is cost less depreciation to date`,
    summary: [
      { label: "Assets in use", value: inUse.length, type: "number" },
      { label: "Cost", value: Number(totals.cost), type: "money" },
      { label: "Accumulated depreciation", value: Number(totals.accumulated), type: "money" },
      { label: "Book value", value: Number(totals.bookValue), type: "money" },
    ],
    ...register,
    title: "Fixed asset register",
    sections: [register, disposedSection],
  };
}

/* Depreciation for a period */

const DEPRECIATION_COLUMNS: ReportColumn[] = [
  col("code", "Code", "text", 10),
  col("name", "Asset", "text", 24),
  col("group", "Group", "text", 18),
  col("method", "Method", "text", 14),
  col("opening", "Opening value", "money", 15),
  col("additions", "Additions", "money", 14),
  col("charged", "Depreciation charged", "money", 15),
  col("disposals", "Disposals", "money", 14),
  col("accumulated", "Accumulated depreciation", "money", 15),
  col("closing", "Book value", "money", 15),
];

const GROUP_COLUMNS: ReportColumn[] = [
  col("group", "Group", "text", 26),
  col("assets", "Assets", "number", 8),
  col("opening", "Opening value", "money", 16),
  col("additions", "Additions", "money", 15),
  col("charged", "Depreciation charged", "money", 16),
  col("disposals", "Disposals", "money", 15),
  col("closing", "Book value", "money", 16),
];

export async function buildDepreciationReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const period = periodFromInputs(f.from, f.to);
  const from = period.from;
  const to = effectiveAsOf(period.to);
  const beforeStart = new Date(from.getTime() - 1);
  const [assets, label] = await Promise.all([
    // Bought by the end, and not disposed of before the start. `"disposal.date": null` also matches a
    // missing or null disposal, so an asset whose disposal was cleared is not dropped.
    FixedAsset.find({ purchaseDate: { $lte: to }, $or: [{ "disposal.date": null }, { "disposal.date": { $gte: from } }] }).lean(),
    groupLabels(),
  ]);
  const sorted = assets.sort((a, b) => label(a.group).localeCompare(label(b.group)) || a.code.localeCompare(b.code));

  const assetRows = sorted.map((a) => {
    const opening = bookValue(a, beforeStart).bookValue;
    const boughtInPeriod = a.purchaseDate.getTime() >= from.getTime();
    const additions = boughtInPeriod ? round2(a.purchaseCost ?? 0) : 0;
    const charged = depreciationBetween(a, from, to);
    const gone = disposedBy(a, to);
    const end = bookValue(a, gone ? a.disposal!.date : to);
    return {
      _group: label(a.group),
      code: a.code,
      name: a.name,
      group: label(a.group),
      method: labelOf(DEPRECIATION_METHODS, (a.depreciationMethod ?? "slm") as DepreciationMethod),
      opening,
      additions,
      charged,
      disposals: gone ? end.bookValue : 0,
      // A disposed asset's depreciation leaves the books with it, as on the balance sheet.
      accumulated: gone ? 0 : end.accumulated,
      closing: gone ? 0 : end.bookValue,
    };
  });

  const rows = withGroupSubtotals(DEPRECIATION_COLUMNS, assetRows);
  const totals = sumTotals(DEPRECIATION_COLUMNS, rows);
  const byGroup = new Map<string, ReportRow>();
  for (const r of assetRows) {
    const g = byGroup.get(r._group) ?? { group: r._group, assets: 0, opening: 0, additions: 0, charged: 0, disposals: 0, closing: 0 };
    g.assets = Number(g.assets) + 1;
    for (const k of ["opening", "additions", "charged", "disposals", "closing"] as const) g[k] = round2(Number(g[k]) + r[k]);
    byGroup.set(r._group, g);
  }
  const groupRows = [...byGroup.values()];
  const detail: ReportSection = { title: "By asset", columns: DEPRECIATION_COLUMNS, rows, totals };
  const groups: ReportSection = { title: "By group", columns: GROUP_COLUMNS, rows: groupRows, totals: sumTotals(GROUP_COLUMNS, groupRows, "Total", ["money", "number"]) };

  const fromDay = toDateInput(from);
  const toDay = toDateInput(to);
  // The books post a whole month's depreciation on its last day, this report counts days: a period
  // that starts inside a month gets that month's full charge in the Profit & Loss but part of it here.
  const midMonth = !fromDay.endsWith("-01");
  return {
    type: "depreciation",
    subtitle: [
      `Period: ${periodText({ from: fromDay, to: toDay })}`,
      "Opening value + additions - depreciation - disposals = book value",
      midMonth ? "The period starts inside a month: this report counts that month's depreciation by day, the Profit & Loss books the whole month on its last day" : "",
    ]
      .filter(Boolean)
      .join(" · "),
    summary: [
      { label: "Opening value", value: Number(totals.opening), type: "money" },
      { label: "Additions", value: Number(totals.additions), type: "money" },
      { label: "Depreciation charged", value: Number(totals.charged), type: "money" },
      { label: "Book value at the end", value: Number(totals.closing), type: "money" },
    ],
    ...detail,
    title: "Depreciation report",
    sections: [detail, groups],
  };
}
