"use server";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Notification } from "@/server/models";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
import { iso } from "@/server/serialize";

export type NotificationDTO = {
  id: string;
  type: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

/** A kind of notice and the permissions that let someone see it (any one is enough). */
type NoticeRule = { match: Record<string, unknown>; any: string[] };

/**
 * Notices that open a page: the page's view permission. `exact` matches only the page itself, not
 * pages under it; `except` leaves out sub-pages that have a rule of their own.
 */
const page = (path: string, any: string[], options: { exact?: boolean; except?: string[] } = {}): NoticeRule => {
  // Paths here are plain letters, hyphens and slashes, so they need no regex escaping.
  const skip = options.except?.length ? `(?!/(${options.except.join("|")})(/|[?#]|$))` : "";
  return { match: { href: { $regex: `^${path}${skip}(${options.exact ? "" : "/|"}[?#]|$)` } }, any };
};

const PROJECT_FINANCE_PAGES = ["budgets", "profitability"];
const STATEMENT_PAGES = ["balance-sheet", "cash-flow", "profit-loss", "trial-balance"];

/**
 * Who sees which notices. Stock alerts go to people who may see items (they open the item page), task
 * notices to people who may see tasks, and any other notice to people who may open the page it
 * links to. Before roles, members saw every notice; the Member defaults keep that. A notice whose
 * link matches no rule here is shown to everyone, so add a rule when a new page sends notices.
 */
const NOTICE_RULES: NoticeRule[] = [
  {
    match: { $or: [{ type: { $in: ["low_stock", "out_of_stock"] } }, { "entity.type": "inventory" }] },
    any: ["inventory.items:view"],
  },
  { match: { $or: [{ type: { $in: ["task_assigned", "task_comment"] } }, { "entity.type": "task" }] }, any: ["tasks.tasks:view"] },
  page("/tasks", ["tasks.tasks:view"]),
  page("/finance", ["finance.dashboard:view"], { exact: true }),
  page("/finance/expenses", ["finance.expenses:view"]),
  page("/finance/payments", ["finance.payments:view"]),
  page("/finance/recurring", ["finance.recurring:view"]),
  page("/finance/bank-statements", ["finance.bank_statements:view"]),
  page("/finance/import", ["finance.import:view"]),
  page("/finance/income", ["finance.income:view"]),
  page("/finance/invoices", ["finance.invoices:view"]),
  page("/finance/projects", ["finance.projects:view"], { except: PROJECT_FINANCE_PAGES }),
  ...PROJECT_FINANCE_PAGES.map((p) => page(`/finance/projects/${p}`, ["finance.project_finance:view"])),
  page("/finance/employees", ["finance.employees:view"]),
  page("/finance/reports", ["finance.reports:view"], { except: STATEMENT_PAGES }),
  ...STATEMENT_PAGES.map((p) => page(`/finance/reports/${p}`, ["finance.statements:view"])),
  page("/finance/assets", ["finance.assets_overview:view"], { exact: true }),
  page("/finance/assets/cash", ["finance.cash_bank:view"]),
  page("/finance/assets/receivables", ["finance.receivables:view"]),
  page("/finance/assets/prepaid", ["finance.prepaid:view"]),
  page("/finance/assets/inventory", ["finance.inventory_valuation:view"]),
  page("/finance/assets/fixed", ["finance.fixed_assets:view"]),
  page("/finance/assets/depreciation", ["finance.fixed_assets:view"]),
  page("/finance/assets/intangible", ["finance.fixed_assets:view"]),
  page("/finance/assets/investments", ["finance.investments:view"]),
  page("/finance/liabilities", ["finance.liabilities:view"]),
  page("/finance/equity", ["finance.equity:view"]),
  page("/inventory", ["inventory.dashboard:view"], { exact: true }),
  page("/inventory/items", ["inventory.items:view"]),
  page("/inventory/categories", ["inventory.categories:view"]),
  page("/inventory/low-stock", ["inventory.low_stock:view"]),
  page("/inventory/import", ["inventory.import:view"]),
  page("/inventory/purchase", ["inventory.purchase:view"]),
  page("/inventory/assign", ["inventory.movement:view"]),
  page("/inventory/return", ["inventory.movement:view"]),
  page("/inventory/transfer", ["inventory.movement:view"]),
  page("/inventory/wastage", ["inventory.wastage:view"]),
  page("/inventory/movements", ["inventory.movements:view"]),
  page("/analytics", ["analytics.dashboard:view"], { exact: true }),
  page("/analytics/scenarios", ["analytics.scenarios:view"]),
  page("/analytics/forecasting", ["analytics.forecasting:view"]),
  page("/analytics/compare", ["analytics.compare:view"]),
  page("/analytics/inventory", ["analytics.inventory:view"]),
  page("/analytics/projects", ["analytics.projects:view"]),
  page("/analytics/insights", ["analytics.insights:view"]),
  page("/settings/team", ["settings.team:view"]),
  page("/settings/roles", ["settings.roles:view"]),
];

/** The notices this person may see: personal or team-wide, minus the kinds their role does not cover. */
function noticeScope(user: SessionUser) {
  const me = new Types.ObjectId(user.id);
  const hidden = NOTICE_RULES.filter((r) => !r.any.some((p) => can(user, p))).map((r) => r.match);
  const mine = { $or: [{ user: null }, { user: me }] };
  return hidden.length ? { $and: [mine, { $nor: hidden }] } : mine;
}

/** Latest notifications for the signed-in user (personal and team-wide) that their role lets them see. */
export async function getNotifications(): Promise<{ items: NotificationDTO[]; unread: number }> {
  const user = await getCurrentUser();
  if (!user) return { items: [], unread: 0 };
  await connectDB();
  const me = new Types.ObjectId(user.id);
  const scope = noticeScope(user);
  const [docs, unread] = await Promise.all([
    Notification.find(scope).sort({ createdAt: -1 }).limit(30).lean(),
    Notification.countDocuments({ ...scope, readBy: { $ne: me } }),
  ]);
  return {
    unread,
    items: docs.map((n) => ({
      id: String(n._id),
      type: n.type,
      severity: (n.severity ?? "info") as NotificationDTO["severity"],
      title: n.title,
      body: n.body ?? null,
      href: n.href ?? null,
      read: (n.readBy ?? []).some((id) => String(id) === user.id),
      createdAt: iso(n.createdAt as Date)!,
    })),
  };
}

export async function markNotificationRead(id: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(id)) return;
  await connectDB();
  await Notification.updateOne({ _id: new Types.ObjectId(id), ...noticeScope(user) }, { $addToSet: { readBy: new Types.ObjectId(user.id) } });
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) return;
  await connectDB();
  const me = new Types.ObjectId(user.id);
  await Notification.updateMany({ ...noticeScope(user), readBy: { $ne: me } }, { $addToSet: { readBy: me } });
}
