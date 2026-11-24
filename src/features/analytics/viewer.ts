import "server-only";

import { can, type SessionUser } from "@/server/auth/session";
import { ANALYTICS, canOpen } from "./links";

/**
 * What a person may see inside analytics figures, from their role's data permissions:
 * `salaries` (pay and salary expenses) and `cash` (P&L, cash, bank and balance-sheet figures).
 * The built-in admin role has both; the built-in member role has neither.
 */
export type AnalyticsViewer = { salaries: boolean; cash: boolean };

export function analyticsViewer(user: SessionUser): AnalyticsViewer {
  return { salaries: can(user, ANALYTICS.salaries), cash: can(user, ANALYTICS.financialPosition) };
}

/** Whether this person can open the page at `href` (cards and charts that link to it). */
export function userCanOpen(user: SessionUser, href: string): boolean {
  return canOpen((p) => can(user, p), href);
}
