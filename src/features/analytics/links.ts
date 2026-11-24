import { perm, resourceOf } from "@/lib/permissions";

/**
 * The view permission of the page an analytics card, chart or button links to, so a card is shown
 * only to people who can open its page. Longest prefix wins; paths not listed need no permission
 * beyond being signed in. Client-safe.
 */
const PAGE_RESOURCES: [prefix: string, resource: string][] = [
  ["/analytics/scenarios/new", "analytics.scenarios:create"],
  ["/analytics/scenarios", "analytics.scenarios:view"],
  ["/analytics/compare", "analytics.compare:view"],
  ["/analytics/forecasting", "analytics.forecasting:view"],
  ["/analytics/inventory", "analytics.inventory:view"],
  ["/analytics/projects", "analytics.projects:view"],
  ["/analytics/insights", "analytics.insights:view"],
  ["/analytics", "analytics.dashboard:view"],
  ["/finance/income", "finance.income:view"],
  ["/finance/invoices", "finance.invoices:view"],
  ["/finance/expenses", "finance.expenses:view"],
  ["/finance/payments", "finance.payments:view"],
  ["/finance/employees", "finance.employees:view"],
  ["/finance/projects/budgets", "finance.project_finance:view"],
  ["/finance/projects/profitability", "finance.project_finance:view"],
  ["/finance/projects", "finance.projects:view"],
  ["/finance/assets/cash", "finance.cash_bank:view"],
  ["/finance/assets/fixed", "finance.fixed_assets:view"],
  ["/finance/reports/profit-loss", "finance.statements:view"],
  ["/finance/reports/cash-flow", "finance.statements:view"],
  ["/finance/reports/balance-sheet", "finance.statements:view"],
  ["/finance/reports/trial-balance", "finance.statements:view"],
  ["/finance", "finance.dashboard:view"],
  ["/inventory/items", "inventory.items:view"],
  ["/inventory/low-stock", "inventory.low_stock:view"],
  ["/inventory/movements", "inventory.movements:view"],
  ["/inventory/purchase", "inventory.purchase:view"],
  ["/inventory/wastage", "inventory.wastage:view"],
  ["/inventory", "inventory.dashboard:view"],
  ["/tasks", "tasks.tasks:view"],
];

// Longest prefix first, so "/analytics/scenarios/new" wins over "/analytics/scenarios".
const SORTED = [...PAGE_RESOURCES].sort((a, b) => b[0].length - a[0].length);

/** The permission needed to open `href`, or null when the page needs none. */
export function pagePermission(href: string): string | null {
  const [beforeHash] = href.split("#");
  const [rawPath, query = ""] = beforeHash.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  if (/^\/analytics\/scenarios\/[^/]+\/edit$/.test(path)) return perm("analytics.scenarios", "edit");
  for (const [prefix, permission] of SORTED) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return createInstead(permission, query);
  }
  return null;
}

/** A list link with ?new=1 opens the create form, so it needs the create permission when the resource has one. */
function createInstead(permission: string, query: string): string {
  if (!new URLSearchParams(query).has("new") || !permission.endsWith(":view")) return permission;
  const resource = permission.slice(0, -":view".length);
  return resourceOf(resource)?.actions.includes("create") ? perm(resource, "create") : permission;
}

/** Whether a person can open `href`, given their permission check. */
export function canOpen(check: (permission: string) => boolean, href: string): boolean {
  const p = pagePermission(href);
  return p === null || check(p);
}

/** Permission strings used across the analytics area. */
export const ANALYTICS = {
  dashboard: perm("analytics.dashboard", "view"),
  scenarios: {
    view: perm("analytics.scenarios", "view"),
    create: perm("analytics.scenarios", "create"),
    edit: perm("analytics.scenarios", "edit"),
    delete: perm("analytics.scenarios", "delete"),
    export: perm("analytics.scenarios", "export"),
    approve: perm("analytics.scenarios", "approve"),
  },
  forecasting: { view: perm("analytics.forecasting", "view"), create: perm("analytics.forecasting", "create") },
  compare: { view: perm("analytics.compare", "view"), export: perm("analytics.compare", "export") },
  inventory: perm("analytics.inventory", "view"),
  projects: perm("analytics.projects", "view"),
  insights: perm("analytics.insights", "view"),
  salaries: "data.salaries",
  financialPosition: "data.financial_position",
} as const;
