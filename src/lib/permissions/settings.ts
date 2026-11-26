import type { DataPermission, PermissionResource } from "./types";

/** Team and role settings. Client-safe. */
export const SETTINGS_RESOURCES: PermissionResource[] = [
  {
    key: "settings.team",
    module: "settings",
    group: "Settings",
    label: "Team members",
    description: "Other people on the team. View lists them, create adds someone, edit changes someone else's role or name. Only admins can set a new password for another person. A person's own password is the next row.",
    actions: ["view", "create", "edit"],
    // Everyone could see the team list before roles existed; only admins could add people.
    memberDefault: ["view"],
  },
  {
    key: "settings.account",
    module: "settings",
    group: "Settings",
    label: "Change own password",
    description: "Change their own password from the account menu. Untick to hide and block it. An admin can still set a new password for them under Team members.",
    actions: ["edit"],
    // Everyone could change their own password before this permission existed, so every role keeps
    // it (Member, existing custom roles, new roles) until an admin unticks it for that role.
    memberDefault: ["edit"],
    defaultOn: ["edit"],
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

/** Changing your own password: the account menu item and Better Auth's /change-password. */
export const OWN_PASSWORD_PERMISSION = "settings.account:edit";

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
