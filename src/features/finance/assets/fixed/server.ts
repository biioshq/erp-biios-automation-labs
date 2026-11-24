import "server-only";

import type { Types } from "mongoose";
import { endOfDayIST, financialYearIST } from "@/lib/dates";
import { bookValue, depreciationBetween, type DepreciableAsset } from "@/lib/depreciation";
import { round2 } from "@/lib/format";

/**
 * Helpers shared by the asset queries and actions. Server-only.
 */

/** Expense sources that are never an asset purchase: they are edited through their own feature. */
export const NOT_LINKABLE_SOURCES = ["inventory_purchase", "inventory_assignment", "inventory_wastage", "liability_interest"];

/**
 * The note written on the unpaid bill created for a "Not paid yet" asset. Only a bill that still
 * carries it (and has nothing paid on it) may be deleted together with the asset; any other expense
 * is the user's own record and is only unlinked.
 */
export const billNote = (code: string) => `Created with fixed asset ${code} (not paid yet).`;

type BillLike = {
  _id: Types.ObjectId;
  number: string;
  notes?: string | null;
  paymentMethod?: string | null;
  source?: string | null;
  capitalAsset?: Types.ObjectId | null;
  payments?: unknown[] | null;
};

/** The bill was created by the asset form for this asset (paid or not since). */
export function isOwnBill(bill: BillLike | null | undefined, asset: { _id: Types.ObjectId; code: string }): boolean {
  if (!bill) return false;
  return String(bill.capitalAsset ?? "") === String(asset._id) && (bill.source ?? "manual") === "manual" && (bill.notes ?? "").startsWith(billNote(asset.code));
}

/** The bill was created by the asset form for this asset and nothing has been paid on it. */
export function isDeletableBill(bill: BillLike | null | undefined, asset: { _id: Types.ObjectId; code: string }): boolean {
  return isOwnBill(bill, asset) && bill!.paymentMethod === "credit" && !(Array.isArray(bill!.payments) && bill!.payments.length > 0);
}

/** What the balance sheet carries for an asset on `asOf`: nothing once it is disposed. */
export function carried(asset: DepreciableAsset, asOf: Date) {
  const v = bookValue(asset, asOf);
  const disposed = Boolean(asset.disposal?.date && new Date(asset.disposal.date).getTime() <= asOf.getTime());
  return { ...v, disposed };
}

/** Figures for a register row as of today: charged so far, book value and this financial year's charge. */
export function figuresToday(asset: DepreciableAsset, now = new Date()) {
  const asOf = endOfDayIST(now);
  const fy = financialYearIST(now);
  const v = carried(asset, asOf);
  return { ...v, chargedThisYear: round2(depreciationBetween(asset, fy.start, asOf)) };
}
