import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem } from "@/server/models";
import { coverage, itemPositions, lookAheadAlerts, usageByItem, type Coverage, type ItemPosition, type StockAlert } from "@/server/analytics/core";
import { addDays, startOfDayIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { loadMovements, projectNames } from "./data";

/**
 * Shortage risk (4.6). "At risk" is exactly the inventory alerts (lookAheadAlerts in the shared
 * core): out of stock, at or below the minimum, or running out within the lead time plus a week.
 * The watch list adds items that run out within the chosen horizon at the recent rate of use.
 * Projects potentially affected are the projects that consumed the item in the window.
 * Purchase orders, expected deliveries and supplier delays are not recorded in the ERP.
 */

export type AffectedProject = { id: string; name: string; code: string; color: string; consumed: number };

export type ShortageRow = ItemPosition &
  Coverage & {
    perDay: number | null;
    consumed: number;
    level: StockAlert["level"] | "watch";
    reasons: string[];
    suggestedQty: number | null;
    /** Price a suggested order is costed at: the last purchase price, as on the low-stock page. */
    orderPrice: number;
    projects: AffectedProject[];
  };

export type ShortageData = {
  atRisk: ShortageRow[];
  watch: ShortageRow[];
  out: number;
  belowMin: number;
  runsOut: number;
  affectedProjects: { id: string; name: string; code: string; color: string; items: number }[];
  itemsWithRate: number;
  itemCount: number;
};

export async function getShortages(windowDays: number, horizonDays: number, now: Date = new Date()): Promise<ShortageData> {
  await connectDB();
  const start = startOfDayIST(addDays(now, -windowDays + 1));
  const [alerts, items, usage, rows, projects] = await Promise.all([
    lookAheadAlerts(now, windowDays),
    itemPositions(),
    usageByItem(windowDays, now),
    loadMovements(start, now),
    projectNames(),
  ]);

  // Net units each project took of each item in the window (issued less returned).
  const byItem = new Map<string, Map<string, number>>();
  for (const m of rows) {
    if (!m.project || (m.type !== "assign" && m.type !== "return")) continue;
    const per = byItem.get(m.item) ?? new Map<string, number>();
    per.set(m.project, (per.get(m.project) ?? 0) + (m.type === "assign" ? m.quantity : -m.quantity));
    byItem.set(m.item, per);
  }
  const projectsOf = (itemId: string): AffectedProject[] =>
    [...(byItem.get(itemId) ?? new Map<string, number>()).entries()]
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const p = projects.get(id);
        return { id, name: p?.name ?? "Deleted project", code: p?.code ?? "", color: p?.color ?? "#94a3b8", consumed: Math.round(q * 1000) / 1000 };
      })
      .sort((a, b) => b.consumed - a.consumed);

  const prices = alerts.length
    ? await InventoryItem.find({ _id: { $in: alerts.map((a) => new Types.ObjectId(a.id)) } }, { lastPurchasePrice: 1 }).lean()
    : [];
  const lastPrice = new Map(prices.map((p) => [String(p._id), p.lastPurchasePrice]));
  const atRisk: ShortageRow[] = alerts.map((a) => ({
    ...a,
    perDay: a.perDay,
    consumed: a.consumed,
    level: a.level,
    reasons: a.reasons,
    suggestedQty: a.suggestedQty,
    orderPrice: lastPrice.get(a.id) ?? a.unitPrice,
    projects: projectsOf(a.id),
  }));
  const flagged = new Set(atRisk.map((r) => r.id));
  const watch: ShortageRow[] = items
    .filter((i) => !flagged.has(i.id))
    .map((i) => {
      const u = usage.get(i.id);
      const c = coverage(i.available, u?.perDay ?? null, i.leadTimeDays, now);
      return { ...i, ...c, perDay: u?.perDay ?? null, consumed: u?.consumed ?? 0 };
    })
    .filter((r) => r.daysOfCover !== null && r.daysOfCover <= horizonDays)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))
    .map((r) => ({ ...r, level: "watch" as const, reasons: [`Runs out in about ${Math.floor(r.daysOfCover ?? 0)} days at the recent rate of use`], suggestedQty: null, orderPrice: r.unitPrice, projects: projectsOf(r.id) }));

  const affected = new Map<string, { id: string; name: string; code: string; color: string; items: number }>();
  for (const r of atRisk) {
    for (const p of r.projects) {
      const row = affected.get(p.id) ?? { id: p.id, name: p.name, code: p.code, color: p.color, items: 0 };
      row.items += 1;
      affected.set(p.id, row);
    }
  }
  return {
    atRisk,
    watch,
    out: atRisk.filter((r) => r.level === "out").length,
    belowMin: atRisk.filter((r) => r.level === "below_min").length,
    runsOut: atRisk.filter((r) => r.level === "runs_out").length,
    affectedProjects: [...affected.values()].sort((a, b) => b.items - a.items),
    itemsWithRate: items.filter((i) => usage.get(i.id)?.perDay).length,
    itemCount: items.length,
  };
}

/** What the suggested quantities cost at each item's last purchase price, as the low-stock page adds it up. */
export const suggestedOrderValue = (rows: ShortageRow[]) => round2(rows.reduce((s, r) => s + (r.suggestedQty ? round2(r.suggestedQty * r.orderPrice) : 0), 0));
