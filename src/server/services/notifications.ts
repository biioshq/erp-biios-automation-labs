import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Counter, Notification, type NotificationType } from "@/server/models";
import { lookAheadAlerts, type StockAlert } from "@/server/analytics/core";
import { getStockStatus } from "@/lib/stock-status";
import { addDays, toDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";

type CreateNotification = {
  type: NotificationType;
  severity?: "info" | "success" | "warning" | "danger";
  title: string;
  body?: string;
  href?: string;
  /** Omit to notify the whole team. */
  user?: string | Types.ObjectId | null;
  entity?: { type: string; id: string | Types.ObjectId };
};

export async function createNotification(input: CreateNotification) {
  return Notification.create({
    ...input,
    user: input.user ? new Types.ObjectId(String(input.user)) : null,
    entity: input.entity ? { type: input.entity.type, id: new Types.ObjectId(String(input.entity.id)) } : undefined,
  });
}

type StockSnapshot = { _id: Types.ObjectId; name: string; sku: string; unit?: string | null; available: number; minStock: number };

/**
 * Called by the ledger after every stock change. Notifies the team when an item
 * crosses into Low Stock or Out of Stock (not on every change while it stays low).
 */
export async function notifyStockLevel(before: StockSnapshot, after: StockSnapshot) {
  const was = getStockStatus(before.available, before.minStock);
  const now = getStockStatus(after.available, after.minStock);
  if (was === now || now === "in_stock") return null;

  const href = `/inventory/items/${after._id}`;
  const unit = after.unit ?? "units";
  if (now === "out_of_stock") {
    return createNotification({
      type: "out_of_stock",
      severity: "danger",
      title: `${after.name} is out of stock`,
      body: `${after.sku}: nothing available. Purchase stock before it can be assigned to a project.`,
      href,
      entity: { type: "inventory", id: after._id },
    });
  }
  return createNotification({
    type: "low_stock",
    severity: "warning",
    title: `${after.name} is running low`,
    body: `${after.sku}: ${formatNumber(after.available)} ${unit} left (minimum ${formatNumber(after.minStock)}). Purchase new stock soon.`,
    href,
    entity: { type: "inventory", id: after._id },
  });
}

/* Daily look-ahead alerts */

/** An item on the reorder list is notified at most once in this many days. */
export const STOCK_ALERT_REPEAT_DAYS = 7;

const STOCK_TYPES: NotificationType[] = ["low_stock", "out_of_stock"];

/** The in-app notification for one item on the reorder list. */
function alertNotification(a: StockAlert): CreateNotification {
  const href = `/inventory/items/${a.id}`;
  const entity = { type: "inventory", id: a.id };
  const left = `${formatNumber(a.available)} ${a.unit} left`;
  const orderBy = a.orderBy ? ` Order by ${formatDate(a.orderBy)}${a.leadTimeDays ? ` (lead time ${a.leadTimeDays} days)` : ""}.` : "";
  const suggest = a.suggestedQty ? ` Suggested order: ${formatNumber(a.suggestedQty)} ${a.unit}.` : "";
  if (a.level === "out") {
    return {
      type: "out_of_stock",
      severity: "danger",
      title: `${a.name} is out of stock`,
      body: `${a.sku}: nothing available. Purchase stock before it can be assigned to a project.${suggest}`,
      href,
      entity,
    };
  }
  if (a.level === "below_min") {
    return {
      type: "low_stock",
      severity: "warning",
      title: `${a.name} is at or below its minimum`,
      body: `${a.sku}: ${left} (minimum ${formatNumber(a.minStock)}).${orderBy}${suggest}`,
      href,
      entity,
    };
  }
  return {
    type: "low_stock",
    severity: "warning",
    title: `${a.name} runs out in about ${Math.floor(a.daysOfCover ?? 0)} days`,
    body: `${a.sku}: ${left} at the recent rate of use.${orderBy}${suggest}`,
    href,
    entity,
  };
}

/**
 * Notifies the team about items on the reorder list (src/server/analytics/core.ts lookAheadAlerts:
 * out of stock, at or below minimum, or running out within lead time plus a week). Each item is
 * notified at most once every STOCK_ALERT_REPEAT_DAYS days, counting the alerts the ledger sends
 * when stock crosses into Low or Out of Stock, so the team is reminded weekly while it stays listed.
 *
 * Runs once per IST day: the first caller claims the day (a counter document keyed by the date),
 * so the cron route and every app instance's scheduler can all call it safely.
 */
export async function notifyStockAlerts(now: Date = new Date()): Promise<{ ran: boolean; listed: number; notified: number }> {
  await connectDB();
  const claimId = `stock-alerts:${toDateInput(now)}`;
  // Two callers racing on the upsert can see a duplicate key error: the other one claimed the day.
  const claim = await Counter.updateOne({ _id: claimId }, { $setOnInsert: { seq: 1 } }, { upsert: true }).catch((error: unknown) => {
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  });
  if (claim?.upsertedCount !== 1) return { ran: false, listed: 0, notified: 0 };

  try {
    const alerts = await lookAheadAlerts(now);
    if (alerts.length === 0) return { ran: true, listed: 0, notified: 0 };
    const recent = await Notification.find(
      {
        type: { $in: STOCK_TYPES },
        "entity.type": "inventory",
        "entity.id": { $in: alerts.map((a) => new Types.ObjectId(a.id)) },
        createdAt: { $gte: addDays(now, -STOCK_ALERT_REPEAT_DAYS) },
      },
      { entity: 1 },
    ).lean();
    const notifiedLately = new Set(recent.map((n) => String(n.entity?.id)));
    const due = alerts.filter((a) => !notifiedLately.has(a.id));
    for (const a of due) await createNotification(alertNotification(a));
    return { ran: true, listed: alerts.length, notified: due.length };
  } catch (error) {
    // Give the day back so the next call (the scheduler's next tick) tries again.
    await Counter.deleteOne({ _id: claimId }).catch(() => {});
    throw error;
  }
}
