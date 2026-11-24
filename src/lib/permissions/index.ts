/**
 * The permission catalogue: every resource, its actions and what the built-in Member role gets.
 * Client-safe. Each area owns its own list; this file joins them.
 *
 * Built-in roles: "admin" always has ALL_PERMISSIONS (never stored, never editable). "member" has
 * MEMBER_DEFAULT_PERMISSIONS until an admin edits it (then its stored role document wins).
 */
import type { PermissionAction, PermissionResource } from "./types";
import { FINANCE_OPS_RESOURCES } from "./finance-ops";
import { FINANCE_BOOKS_RESOURCES } from "./finance-books";
import { INVENTORY_RESOURCES } from "./inventory";
import { ANALYTICS_RESOURCES } from "./analytics";
import { TASKS_RESOURCES } from "./tasks";
import { DATA_PERMISSIONS, SETTINGS_RESOURCES } from "./settings";

export type { DataPermission, Permission, PermissionAction, PermissionResource } from "./types";
export { DATA_PERMISSIONS };

export const ADMIN_ROLE = "admin";
export const MEMBER_ROLE = "member";
export const BUILT_IN_ROLES = [ADMIN_ROLE, MEMBER_ROLE] as const;

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
  approve: "Approve",
};
export const ACTION_ORDER: PermissionAction[] = ["view", "create", "edit", "delete", "export", "approve"];

export const MODULE_LABELS: Record<PermissionResource["module"], string> = {
  finance: "Finance",
  inventory: "Inventory",
  analytics: "Analytics & Planning",
  tasks: "Tasks",
  settings: "Settings",
};

/** Every resource, in module order (as the sidebar lists them). */
export const ALL_RESOURCES: PermissionResource[] = [
  ...FINANCE_OPS_RESOURCES,
  ...FINANCE_BOOKS_RESOURCES,
  ...INVENTORY_RESOURCES,
  ...ANALYTICS_RESOURCES,
  ...TASKS_RESOURCES,
  ...SETTINGS_RESOURCES,
];

const RESOURCE_BY_KEY = new Map(ALL_RESOURCES.map((r) => [r.key, r]));

export function resourceOf(key: string): PermissionResource | undefined {
  return RESOURCE_BY_KEY.get(key);
}

/** "finance.equity" + "view" gives "finance.equity:view". */
export function perm(resource: string, action: PermissionAction): string {
  return `${resource}:${action}`;
}

/** Splits "finance.equity:view" into its resource and action; null for data permissions and unknown strings. */
export function parsePermission(p: string): { resource: string; action: PermissionAction } | null {
  const at = p.lastIndexOf(":");
  if (at <= 0) return null;
  const resource = p.slice(0, at);
  const action = p.slice(at + 1) as PermissionAction;
  return RESOURCE_BY_KEY.get(resource)?.actions.includes(action) ? { resource, action } : null;
}

export const ALL_PERMISSIONS: string[] = [
  ...ALL_RESOURCES.flatMap((r) => r.actions.map((a) => perm(r.key, a))),
  ...DATA_PERMISSIONS.map((d) => d.key),
];

const KNOWN = new Set(ALL_PERMISSIONS);

export function isKnownPermission(p: string): boolean {
  return KNOWN.has(p);
}

export const MEMBER_DEFAULT_PERMISSIONS: string[] = [
  ...ALL_RESOURCES.flatMap((r) => r.memberDefault.filter((a) => r.actions.includes(a)).map((a) => perm(r.key, a))),
  ...DATA_PERMISSIONS.filter((d) => d.memberDefault).map((d) => d.key),
];

export function hasPermission(granted: readonly string[] | ReadonlySet<string>, p: string): boolean {
  return Array.isArray(granted) ? granted.includes(p) : (granted as ReadonlySet<string>).has(p);
}

/**
 * Cleans a permission list before it is saved or used: drops strings the catalogue does not know,
 * adds "view" to any resource that has another action (nothing works on a page you cannot open),
 * removes duplicates and sorts in catalogue order.
 */
export function normalizePermissions(list: readonly string[]): string[] {
  const set = new Set(list.filter((p) => KNOWN.has(p)));
  for (const p of [...set]) {
    const parsed = parsePermission(p);
    const view = parsed ? perm(parsed.resource, "view") : null;
    if (view && KNOWN.has(view)) set.add(view);
  }
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}
