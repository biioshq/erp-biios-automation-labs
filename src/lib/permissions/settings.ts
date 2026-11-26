import type { DataPermission, PermissionResource } from "./types";

/** Team and role settings. Client-safe. */
export const SETTINGS_RESOURCES: PermissionResource[] = [
  {
    key: "settings.team",
    module: "settings",
    group: "Settings",
    label: "Team members",
    description: "See the team. Create adds people, edit changes a person's role or name. Only admins can set a new password for someone.",
    actions: ["view", "create", "edit"],
    // Everyone could see the team list before roles existed; only admins could add people.
    memberDefault: ["view"],
  },
  {
    key: "settings.roles",
    module: "settings",
    group: "Settings",
    label: "Roles and permissions",
    description: "See the roles and what each one opens. Edit creates, changes and deletes roles.",
    actions: ["view", "edit"],
    memberDefault: [],
  },
  {
    key: "settings.company",
    module: "settings",
    group: "Settings",
    label: "Business details",
    description: "See the company's legal name, GSTIN, address and bank details that print on invoices, receipts and statements. Edit changes them.",
    actions: ["view", "edit"],
    memberDefault: [],
  },
];

/** Permissions on data that shows up across many pages rather than on one page. */
export const DATA_PERMISSIONS: DataPermission[] = [
  {
    key: "data.salaries",
    label: "Individual salaries",
    description: "See each person's salary, salary expenses and pay records. Without it, project and expense figures leave salaries out.",
    memberDefault: false,
  },
  {
    key: "data.financial_position",
    label: "Company financial position",
    description: "See company profit and loss, cash, bank balances and balance sheet figures where they appear on other pages: dashboards, analytics and project summaries. The statements, Cash & bank, Assets overview, Liabilities and Capital / Equity pages follow their own view permission.",
    memberDefault: false,
  },
];
