import "server-only";

import { Types } from "mongoose";
import { Notification, type NotificationType } from "@/server/models";
import { getStockStatus } from "@/lib/stock-status";
import { formatNumber } from "@/lib/format";

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
