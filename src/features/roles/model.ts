/**
 * Role helpers shared by the roles pages (client) and the role actions (server). Client-safe.
 */
import { ACTION_LABELS, DATA_PERMISSIONS, DEFAULT_ON_PERMISSIONS, MODULE_LABELS, hasPermission, parsePermission, resourceOf } from "@/lib/permissions";
import { SETTINGS_PAGES, canOpen, visibleModules } from "@/config/navigation";

/** A role as the roles pages show it. */
export type RoleSummary = {
  key: string;
  name: string;
  description: string;
  /** admin and member. */
  builtIn: boolean;
  /** The built-in Admin role: every permission, cannot be changed. */
  locked: boolean;
  /** Member with no edits saved (it follows the catalogue defaults). */
  isDefault: boolean;
  permissions: string[];
  people: { id: string; name: string }[];
};

const SELF_SERVICE = new Set(DEFAULT_ON_PERMISSIONS);

/**
 * Permissions in `list` that `holder` does not have. Default-on permissions (such as changing your
 * own password) are left out: they only act on the person's own account, so holding or giving one
 * never goes beyond someone's role, and unticking one on a role must not stop that role managing
 * people or roles.
 */
export function missingFrom(holder: readonly string[], list: readonly string[]): string[] {
  const held = new Set(holder);
  return list.filter((p) => !held.has(p) && !SELF_SERVICE.has(p));
}

/** "finance.equity:view" as people read it: "Capital and equity: View". */
export function permissionLabel(p: string): string {
  const data = DATA_PERMISSIONS.find((d) => d.key === p);
  if (data) return data.label;
  const parsed = parsePermission(p);
  if (!parsed) return p;
  return `${resourceOf(parsed.resource)?.label ?? parsed.resource}: ${ACTION_LABELS[parsed.action]}`;
}

/** A role key from a name: "Site supervisor" gives "site-supervisor". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "role"
  );
}

/** What a role opens, for the read-only summary: each module with its pages, the settings pages and the data permissions. */
export function pagesOpened(permissions: readonly string[]): {
  modules: { title: string; pages: string[] }[];
  settings: string[];
  data: string[];
} {
  const set = new Set(permissions);
  const can = (p: string) => hasPermission(set, p);
  const modules = visibleModules(can).map((m) => ({
    title: m.title,
    pages: m.items.flatMap((i) => (i.children?.length ? i.children.map((c) => c.title) : [i.title])),
  }));
  return {
    modules,
    settings: SETTINGS_PAGES.filter((p) => canOpen(p, can)).map((p) => p.title),
    data: DATA_PERMISSIONS.filter((d) => set.has(d.key)).map((d) => d.label),
  };
}

export { MODULE_LABELS };
