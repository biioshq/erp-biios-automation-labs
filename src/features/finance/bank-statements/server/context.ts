import "server-only";

import { BankAccount, EquityHolder, Expense, Income, Liability, Project } from "@/server/models";
import { loadExpenseCategories } from "@/server/expense-categories";
import { loadFinanceGroups } from "@/server/finance-groups";
import { liabilityState } from "@/server/finance/summaries";
import { LIABILITY_ENTRY_GROUPS } from "@/lib/finance-groups";
import { addDays } from "@/lib/dates";
import type { StatementPickers } from "../types";

/** Expense history older than this is not used to guess a vendor's category. */
const HISTORY_DAYS = 730;

export type OwnAccount = { id: string; name: string; kind: "bank" | "cash"; bankName: string | null; last4: string | null; archived: boolean };

export type VendorHistory = { name: string; category: string; count: number };

/** Lists the review and the pickers both need. */
export async function loadPickers(): Promise<StatementPickers> {
  const [accounts, projects, categories, holders, loans, groups] = await Promise.all([
    BankAccount.find({ archivedAt: null }, { name: 1, kind: 1, bankName: 1, accountLast4: 1 }).sort({ kind: 1, name: 1 }).lean(),
    Project.find({}, { name: 1, code: 1, client: 1, status: 1 }).sort({ name: 1 }).lean(),
    loadExpenseCategories(),
    EquityHolder.find({ archivedAt: null }, { name: 1, kind: 1 }).sort({ name: 1 }).lean(),
    Liability.find({ archivedAt: null }, { code: 1, name: 1, lender: 1, originalAmount: 1, dueDate: 1, payments: 1, kind: 1 }).sort({ date: -1 }).lean(),
    loadFinanceGroups("liability"),
  ]);
  const entryRoots = new Set(LIABILITY_ENTRY_GROUPS);
  return {
    accounts: accounts.map((a) => ({
      value: String(a._id),
      label: a.name,
      description: [a.kind === "cash" ? "Cash" : a.bankName, a.accountLast4 ? `…${a.accountLast4}` : null].filter(Boolean).join(" · "),
      kind: a.kind as "bank" | "cash",
    })),
    projects: projects.map((p) => ({ value: String(p._id), label: p.name, description: [p.code, p.client].filter(Boolean).join(" · "), status: p.status })),
    // Inventory is written by stock purchases and assignments only; hidden categories take no new records.
    categories: categories.filter((c) => !c.hidden && c.value !== "inventory").map((c) => ({ value: c.value, label: c.label })),
    holders: holders.map((h) => ({ value: String(h._id), label: h.name, description: h.kind === "investor" ? "Investor" : "Owner", kind: h.kind })),
    loans: loans.map((l) => {
      const s = liabilityState(l);
      return { value: String(l._id), label: `${l.code} · ${l.name}`, description: l.lender, outstanding: s.outstanding };
    }),
    // Groups a loan can be filed under: the ones entered on the Liabilities pages and the subgroups under them.
    liabilityGroups: groups
      .filter((g) => entryRoots.has(g.key) || (!g.builtIn && g.path && groups.some((r) => entryRoots.has(r.key) && g.path.startsWith(r.path))))
      .map((g) => ({ value: g.key, label: g.path })),
  };
}

export async function loadOwnAccounts(): Promise<OwnAccount[]> {
  const docs = await BankAccount.find({}, { name: 1, kind: 1, bankName: 1, accountLast4: 1, archivedAt: 1 }).lean();
  return docs.map((a) => ({
    id: String(a._id),
    name: a.name,
    kind: a.kind as "bank" | "cash",
    bankName: a.bankName ?? null,
    last4: a.accountLast4 ?? null,
    archived: Boolean(a.archivedAt),
  }));
}

/** Each vendor's most used category in the last two years, keyed by the vendor's name in lower case. */
export async function loadVendorHistory(): Promise<Map<string, VendorHistory>> {
  const rows = await Expense.aggregate<{ _id: { v: string; c: string }; n: number; name: string }>([
    { $match: { date: { $gte: addDays(new Date(), -HISTORY_DAYS) }, source: { $in: ["manual", "recurring", "inventory_purchase"] } } },
    { $group: { _id: { v: { $toLower: "$vendor" }, c: "$category" }, n: { $sum: 1 }, name: { $last: "$vendor" } } },
  ]);
  const out = new Map<string, VendorHistory>();
  for (const r of rows) {
    const key = r._id.v.trim().replace(/\s+/g, " ");
    const had = out.get(key);
    // Stock purchases are "inventory", which a statement line can never be; another category wins.
    const usable = r._id.c !== "inventory";
    if (!had || (usable && (had.category === "inventory" || r.n > had.count))) out.set(key, { name: r.name, category: r._id.c, count: r.n });
  }
  return out;
}

/** Client names from income and projects. */
export async function loadClientNames(): Promise<string[]> {
  const [fromIncome, fromProjects] = await Promise.all([Income.distinct("client"), Project.distinct("client")]);
  const seen = new Map<string, string>();
  for (const n of [...fromIncome, ...fromProjects] as unknown[]) {
    if (typeof n !== "string" || !n.trim()) continue;
    const k = n.trim().toLowerCase();
    if (!seen.has(k)) seen.set(k, n.trim());
  }
  return [...seen.values()];
}
