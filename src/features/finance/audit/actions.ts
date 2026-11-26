"use server";

import { Types } from "mongoose";
import { can, getCurrentUser } from "@/server/auth/session";
import type { AuditRow } from "@/lib/audit";
import { entityHistory } from "./queries";

/** The page each record type opens on: History needs that page too. */
const VIEW_PERMISSION = { expense: "finance.expenses:view", income: "finance.income:view", invoice: "finance.invoices:view" } as const;

/**
 * The History section of an expense, income or invoice drawer. Needs the Audit trail permission and
 * the record's own page; salary entries also need the salaries permission. Reads only.
 */
export async function fetchAuditHistory(type: keyof typeof VIEW_PERMISSION, id: string): Promise<AuditRow[] | null> {
  const user = await getCurrentUser();
  if (!user || typeof type !== "string" || !Object.hasOwn(VIEW_PERMISSION, type) || typeof id !== "string" || !Types.ObjectId.isValid(id)) return null;
  if (!can(user, "finance.audit:view") || !can(user, VIEW_PERMISSION[type])) return null;
  return entityHistory(type, id, user);
}
