import "server-only";

import { cache } from "react";
import { connectDB } from "@/server/db";
import { FinanceGroup } from "@/server/models";
import { AppError } from "@/server/errors";
import { BUILT_IN_GROUPS, type FinanceKind } from "@/lib/finance-groups";
import type { GroupOption } from "@/features/finance/groups/types";

/**
 * The asset, liability and equity groups as one tree: the built-in groups (src/lib/finance-groups.ts)
 * with the subgroups admins added under them. Records store a group's key, so a subgroup is used
 * exactly like a built-in group.
 */
export async function loadFinanceGroups(kind?: FinanceKind, options: { includeArchived?: boolean } = {}): Promise<GroupOption[]> {
  await connectDB();
  const custom = await FinanceGroup.find({ ...(kind ? { kind } : {}), ...(options.includeArchived ? {} : { archivedAt: null }) })
    .sort({ name: 1 })
    .lean();
  const all: Omit<GroupOption, "depth" | "path">[] = [
    ...BUILT_IN_GROUPS.filter((g) => !kind || g.kind === kind).map((g) => ({
      key: g.key,
      label: g.label,
      parent: g.parent,
      kind: g.kind,
      builtIn: true,
      description: g.description ?? null,
      details: null,
      archived: false,
    })),
    ...custom.map((g) => ({
      key: String(g._id),
      label: g.name,
      parent: g.parent,
      kind: g.kind as FinanceKind,
      builtIn: false,
      description: g.description ?? null,
      details: g.details ?? null,
      archived: Boolean(g.archivedAt),
    })),
  ];
  const byKey = new Map(all.map((g) => [g.key, g]));
  const children = new Map<string | null, typeof all>();
  for (const g of all) {
    const parent = g.parent && byKey.has(g.parent) ? g.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), g]);
  }
  // Depth-first, built-ins in their defined order, subgroups by name after them.
  const out: GroupOption[] = [];
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const g of children.get(parent) ?? []) {
      const p = [...path, g.label];
      out.push({ ...g, depth, path: p.join(" › ") });
      walk(g.key, depth + 1, p);
    }
  };
  walk(null, 0, []);
  return out;
}

export const getFinanceGroups = cache(loadFinanceGroups);

/** The group key itself and every group under it. */
export function descendantsOf(groups: GroupOption[], root: string): string[] {
  const out = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.parent && out.has(g.parent) && !out.has(g.key)) {
        out.add(g.key);
        grew = true;
      }
    }
  }
  return [...out];
}

/**
 * A group a record is filed under must be `root` or a group below it (a fixed asset under Fixed
 * assets, a loan under one of the liability groups). Throws a field error otherwise.
 */
export async function assertGroupUnder(group: string, roots: string[], field = "group"): Promise<void> {
  const groups = await loadFinanceGroups();
  const allowed = new Set(roots.flatMap((r) => descendantsOf(groups, r)));
  if (!allowed.has(group)) throw new AppError("Pick one of the groups listed.", "invalid", { [field]: ["Pick one of the groups listed"] });
}
