import "server-only";

import { connectDB } from "@/server/db";
import { FinanceGroup } from "@/server/models";
import { BUILT_IN_GROUPS, builtInAncestors, builtInGroup } from "@/lib/finance-groups";
import { PL_SECTION_LABELS, type BalanceSheet, type CashFlow, type LedgerAccountMeta, type PlSection, type Posting, type ProfitAndLoss, type StatementLine, type TrialBalanceRow } from "@/lib/accounting";
import { endOfDayIST, financialYearIST, fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { effectiveAsOf, ledgerAsOf, type Ledger } from "./ledger";

/**
 * Financial statements from the computed ledger (./ledger.ts). Every figure here is a sum of
 * postings, so the trial balance, balance sheet, profit & loss and cash flow always agree.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Balance of each account over postings that pass `keep`. Debits positive. */
function balances(postings: Posting[], keep: (p: Posting) => boolean = () => true): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of postings) if (keep(p)) out.set(p.account, (out.get(p.account) ?? 0) + p.amount);
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

const isPl = (m: LedgerAccountMeta | undefined) => m?.type === "income" || m?.type === "expense";

/* Trial balance */

export async function trialBalance(asOf?: Date | null): Promise<{ asOf: string; rows: TrialBalanceRow[]; debit: number; credit: number }> {
  const ledger = await ledgerAsOf(asOf);
  const bal = balances(ledger.postings);
  const rows: TrialBalanceRow[] = [];
  for (const [code, amount] of bal) {
    if (Math.abs(amount) < 0.005) continue;
    const meta = ledger.accounts.get(code)!;
    rows.push({ code, name: meta.name, type: meta.type, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
  }
  const order = { asset: 0, liability: 1, equity: 2, income: 3, expense: 4 } as const;
  rows.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name));
  return {
    asOf: toDateInput(ledger.asOf),
    rows,
    debit: round2(rows.reduce((s, r) => s + r.debit, 0)),
    credit: round2(rows.reduce((s, r) => s + r.credit, 0)),
  };
}

/* Balance sheet */

type GroupNode = { key: string; label: string; parent: string | null; kind: "asset" | "liability" | "equity" };

async function groupTree(): Promise<Map<string, GroupNode>> {
  await connectDB();
  const custom = await FinanceGroup.find({ archivedAt: null }, { kind: 1, parent: 1, name: 1 }).lean();
  const nodes = new Map<string, GroupNode>();
  for (const g of BUILT_IN_GROUPS) nodes.set(g.key, { key: g.key, label: g.label, parent: g.parent, kind: g.kind });
  for (const g of custom) nodes.set(String(g._id), { key: String(g._id), label: g.name, parent: g.parent, kind: g.kind as GroupNode["kind"] });
  nodes.set("opening_balance", { key: "opening_balance", label: "Opening balance equity", parent: null, kind: "equity" });
  return nodes;
}

/** The top-level group a group belongs to (current_assets, non_current_assets, current_liabilities...). */
function rootOf(key: string, nodes: Map<string, GroupNode>): string {
  let k = key;
  for (let i = 0; i < 20; i++) {
    const n = nodes.get(k);
    if (!n?.parent) return k;
    k = n.parent;
  }
  return k;
}

/**
 * The second level under a root (Fixed assets, Inventory, Accounts payable...), so a subgroup's
 * balance adds to its built-in group and shows as a child line under it.
 */
function sectionOf(key: string, nodes: Map<string, GroupNode>): string {
  let k = key;
  for (let i = 0; i < 20; i++) {
    const n = nodes.get(k);
    if (!n?.parent) return k;
    const parent = nodes.get(n.parent);
    if (!parent?.parent) return k;
    k = n.parent;
  }
  return k;
}

const GROUP_HREF: Record<string, string> = {
  inventory: "/finance/assets/inventory",
  cash_equivalents: "/finance/assets/cash",
  receivables: "/finance/assets/receivables",
  prepaid: "/finance/assets/prepaid",
  fixed_assets: "/finance/assets/fixed",
  intangible_assets: "/finance/assets/intangible",
  long_term_investments: "/finance/assets/investments",
  accounts_payable: "/finance/liabilities/payables",
  owners_capital: "/finance/equity/owners",
  investors_capital: "/finance/equity/investors",
  drawings: "/finance/equity/drawings",
  retained_earnings: "/finance/equity/retained-earnings",
  reserves_surplus: "/finance/equity/reserves",
};

export async function balanceSheet(asOf?: Date | null): Promise<BalanceSheet> {
  const [ledger, nodes] = await Promise.all([ledgerAsOf(asOf), groupTree()]);
  const bal = balances(ledger.postings);
  const fy = financialYearIST(ledger.asOf);

  // Profit: all income and expense accounts. This year's profit is shown apart from earlier years'.
  let profitAll = 0;
  let profitYear = 0;
  for (const p of ledger.postings) {
    if (!isPl(ledger.accounts.get(p.account))) continue;
    profitAll -= p.amount;
    if (p.date.getTime() >= fy.start.getTime()) profitYear -= p.amount;
  }
  profitAll = round2(profitAll);
  profitYear = round2(profitYear);

  // GST: input credit and output tax net off into one line, payable or receivable.
  const gstNet = round2((bal.get("gst_output") ?? 0) + (bal.get("gst_input") ?? 0));
  bal.delete("gst_output");
  bal.delete("gst_input");

  // Section → its accounts' total, with child lines per account (and per subgroup).
  type Bucket = { key: string; label: string; amount: number; children: Map<string, StatementLine> };
  const buckets = new Map<string, Bucket>();
  const add = (groupKey: string, line: StatementLine, sign: 1 | -1) => {
    // Equity groups gather under their root (Reserves and surplus holds every reserve as a child line).
    const root = rootOf(groupKey, nodes);
    const section = nodes.get(root)?.kind === "equity" ? root : sectionOf(groupKey, nodes);
    const b = buckets.get(section) ?? { key: section, label: nodes.get(section)?.label ?? groupKey, amount: 0, children: new Map() };
    b.amount = round2(b.amount + sign * line.amount);
    const existing = b.children.get(line.key);
    if (existing) existing.amount = round2(existing.amount + sign * line.amount);
    else b.children.set(line.key, { ...line, amount: round2(sign * line.amount) });
    buckets.set(section, b);
  };

  for (const [code, amount] of bal) {
    const meta = ledger.accounts.get(code);
    if (!meta || isPl(meta) || Math.abs(amount) < 0.005) continue;
    const group = meta.group ?? (meta.type === "asset" ? "other_current_assets" : meta.type === "liability" ? "other_current_liabilities" : "opening_balance");
    // Child lines: one per cash or bank account, otherwise one per group (a fixed-asset group nets its cost and depreciation).
    const line: StatementLine = { key: meta.cash ? code : group, label: meta.cash ? meta.name : (nodes.get(group)?.label ?? meta.name), amount };
    add(group, line, meta.type === "asset" ? 1 : -1);
  }
  if (gstNet > 0.005) add("gst_receivable", { key: "gst_net", label: "GST input credit (more paid than charged)", amount: gstNet }, 1);
  else if (gstNet < -0.005) add("taxes_payable", { key: "gst_net", label: "GST payable", amount: gstNet }, -1);

  const lineOf = (b: Bucket): StatementLine => {
    const children = [...b.children.values()].filter((c) => Math.abs(c.amount) >= 0.005);
    return {
      key: b.key,
      label: b.label,
      amount: b.amount,
      href: GROUP_HREF[b.key],
      ...(children.length > 1 || (children.length === 1 && children[0].label !== b.label) ? { children } : {}),
    };
  };
  const pick = (root: string) =>
    [...buckets.values()]
      .filter((b) => rootOf(b.key, nodes) === root)
      .map(lineOf)
      .sort((a, b) => order(a.key) - order(b.key));
  const order = (key: string) => {
    const i = BUILT_IN_GROUPS.findIndex((g) => g.key === key);
    return i < 0 ? 999 : i;
  };
  const sum = (lines: StatementLine[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

  const currentAssets = pick("current_assets");
  const nonCurrentAssets = pick("non_current_assets");
  const currentLiabilities = pick("current_liabilities");
  const nonCurrentLiabilities = pick("non_current_liabilities");

  // Equity: capital, reserves, drawings (negative), opening balances, and retained earnings.
  const equityLines = [...buckets.values()]
    .filter((b) => nodes.get(rootOf(b.key, nodes))?.kind === "equity" || b.key === "opening_balance")
    .filter((b) => b.key !== "retained_earnings")
    .map(lineOf);
  const retainedEntries = -(bal.get("retained") ?? 0);
  equityLines.push({
    key: "retained_earnings",
    label: "Retained earnings",
    amount: round2(retainedEntries + profitAll),
    href: GROUP_HREF.retained_earnings,
    children: [
      { key: "retained_previous", label: "From earlier years", amount: round2(retainedEntries + profitAll - profitYear) },
      { key: "retained_year", label: `Profit or loss, ${fy.label}`, amount: profitYear },
    ],
  });
  equityLines.sort((a, b) => order(a.key) - order(b.key));

  const totalAssets = round2(sum(currentAssets) + sum(nonCurrentAssets));
  const totalLiabilities = round2(sum(currentLiabilities) + sum(nonCurrentLiabilities));
  const totalEquity = sum(equityLines);
  return {
    asOf: toDateInput(ledger.asOf),
    assets: { current: currentAssets, nonCurrent: nonCurrentAssets, totalCurrent: sum(currentAssets), totalNonCurrent: sum(nonCurrentAssets), total: totalAssets },
    liabilities: {
      current: currentLiabilities,
      nonCurrent: nonCurrentLiabilities,
      totalCurrent: sum(currentLiabilities),
      totalNonCurrent: sum(nonCurrentLiabilities),
      total: totalLiabilities,
    },
    equity: { lines: equityLines, total: totalEquity },
    difference: round2(totalAssets - totalLiabilities - totalEquity),
  };
}

/* Profit & loss */

export async function profitAndLoss(from: Date, to: Date): Promise<ProfitAndLoss> {
  const ledger = await ledgerAsOf(to);
  const start = startOfDayIST(from).getTime();
  const end = ledger.asOf.getTime();
  const bal = balances(ledger.postings, (p) => p.date.getTime() >= start && p.date.getTime() <= end && isPl(ledger.accounts.get(p.account)));

  const sections = new Map<PlSection, StatementLine[]>();
  for (const [code, amount] of bal) {
    const meta = ledger.accounts.get(code)!;
    if (Math.abs(amount) < 0.005) continue;
    const section = meta.pl ?? (meta.type === "income" ? "other_income" : "indirect");
    // Income is a credit: show it positive. Expenses are debits: positive too.
    const shown = meta.type === "income" ? -amount : amount;
    (sections.get(section) ?? sections.set(section, []).get(section)!).push({ key: code, label: meta.name, amount: shown });
  }
  const ORDER: PlSection[] = ["revenue", "other_income", "materials", "direct", "indirect", "depreciation", "finance", "other_expense"];
  const out = ORDER.filter((k) => sections.has(k)).map((k) => {
    const lines = sections.get(k)!.sort((a, b) => b.amount - a.amount);
    return { key: k, label: PL_SECTION_LABELS[k], lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
  });
  const total = (keys: PlSection[]) => round2(out.filter((s) => keys.includes(s.key)).reduce((s, x) => s + x.total, 0));
  const totalIncome = total(["revenue", "other_income"]);
  const totalExpenses = total(["materials", "direct", "indirect", "depreciation", "finance", "other_expense"]);
  return {
    from: toDateInput(from),
    to: toDateInput(ledger.asOf),
    sections: out,
    totalIncome,
    totalExpenses,
    grossProfit: round2(total(["revenue"]) - total(["materials", "direct"])),
    profit: round2(totalIncome - totalExpenses),
  };
}

/* Cash flow (direct method) */

const ACTIVITY_LABELS = { operating: "Operating activities", investing: "Investing activities", financing: "Financing activities" } as const;

export async function cashFlow(from: Date, to: Date): Promise<CashFlow> {
  const ledger = await ledgerAsOf(to);
  const start = startOfDayIST(from).getTime();
  const end = ledger.asOf.getTime();
  const cashCodes = new Set([...ledger.accounts.values()].filter((a) => a.cash).map((a) => a.code));

  const perAccount = new Map<string, { opening: number; inflow: number; outflow: number }>();
  const lines = new Map<string, Map<string, number>>();
  for (const p of ledger.postings) {
    if (!cashCodes.has(p.account)) continue;
    const t = p.date.getTime();
    const acc = perAccount.get(p.account) ?? { opening: 0, inflow: 0, outflow: 0 };
    if (t < start) acc.opening += p.amount;
    else if (t <= end) {
      if (p.amount >= 0) acc.inflow += p.amount;
      else acc.outflow -= p.amount;
      const activity = p.cf?.activity ?? "operating";
      if (activity !== "internal") {
        const m = lines.get(activity) ?? new Map<string, number>();
        m.set(p.cf?.line ?? "Other", (m.get(p.cf?.line ?? "Other") ?? 0) + p.amount);
        lines.set(activity, m);
      } else if (p.cf?.line === "Opening balance") {
        // An opening balance set inside the period is not a cash flow: it moves into the opening figure.
        acc.opening += p.amount;
        acc.inflow -= Math.max(0, p.amount);
        acc.outflow -= Math.max(0, -p.amount);
      }
    }
    perAccount.set(p.account, acc);
  }
  const activities = (["operating", "investing", "financing"] as const).map((k) => {
    const m = lines.get(k) ?? new Map<string, number>();
    const ls = [...m.entries()].map(([label, amount]) => ({ key: label, label, amount: round2(amount) })).filter((l) => Math.abs(l.amount) >= 0.005);
    return { key: k, label: ACTIVITY_LABELS[k], lines: ls, net: round2(ls.reduce((s, l) => s + l.amount, 0)) };
  });
  const accounts = [...perAccount.entries()].map(([code, a]) => ({
    code,
    name: ledger.accounts.get(code)?.name ?? code,
    opening: round2(a.opening),
    inflow: round2(a.inflow),
    outflow: round2(a.outflow),
    closing: round2(a.opening + a.inflow - a.outflow),
  }));
  const opening = round2(accounts.reduce((s, a) => s + a.opening, 0));
  const closing = round2(accounts.reduce((s, a) => s + a.closing, 0));
  return { from: toDateInput(from), to: toDateInput(ledger.asOf), opening, closing, activities, netChange: round2(closing - opening), accounts };
}

/* Building blocks for dashboards and section pages */

/** Balance of one ledger account (debit positive) as of a day. */
export async function accountBalance(code: string, asOf?: Date | null): Promise<number> {
  const ledger = await ledgerAsOf(asOf);
  return round2(ledger.postings.reduce((s, p) => (p.account === code ? s + p.amount : s), 0));
}

/** Every posting to one ledger account between two days (inclusive), with the running balance. */
export async function accountHistory(code: string, from?: Date | null, to?: Date | null) {
  const ledger = await ledgerAsOf(to);
  const start = from ? startOfDayIST(from).getTime() : -Infinity;
  let running = 0;
  let opening = 0;
  const rows: { date: string; label: string; href?: string; memo?: string; amount: number; balance: number; kind: string }[] = [];
  for (const p of ledger.postings) {
    if (p.account !== code) continue;
    running = round2(running + p.amount);
    if (p.date.getTime() < start) {
      opening = running;
      continue;
    }
    rows.push({ date: p.date.toISOString(), label: p.source.label, href: p.source.href, memo: p.memo, amount: p.amount, balance: running, kind: p.source.kind });
  }
  return { opening, closing: running, rows };
}

/** Balances of all cash and bank accounts as of a day (unassigned ones only when they hold something). */
export async function cashBalances(asOf?: Date | null) {
  const ledger = await ledgerAsOf(asOf);
  const bal = balances(ledger.postings, (p) => ledger.accounts.get(p.account)?.cash === true);
  return ledger.book.accounts
    .filter((a) => a.id || Math.abs(bal.get(a.code) ?? 0) >= 0.005)
    .map((a) => ({ code: a.code, id: a.id, name: a.name, kind: a.kind, archived: a.archived, balance: bal.get(a.code) ?? 0, openingBalance: a.openingBalance, openingDate: a.openingDate ? toDateInput(a.openingDate) : null }));
}

/** Totals for headline cards: assets, liabilities, equity, cash, receivables, payables, inventory. */
export async function positionSummary(asOf?: Date | null) {
  const sheet = await balanceSheet(asOf);
  const find = (lines: StatementLine[], key: string) => lines.find((l) => l.key === key)?.amount ?? 0;
  const all = [...sheet.assets.current, ...sheet.assets.nonCurrent];
  const liab = [...sheet.liabilities.current, ...sheet.liabilities.nonCurrent];
  return {
    asOf: sheet.asOf,
    totalAssets: sheet.assets.total,
    currentAssets: sheet.assets.totalCurrent,
    nonCurrentAssets: sheet.assets.totalNonCurrent,
    totalLiabilities: sheet.liabilities.total,
    currentLiabilities: sheet.liabilities.totalCurrent,
    nonCurrentLiabilities: sheet.liabilities.totalNonCurrent,
    equity: sheet.equity.total,
    cash: find(all, "cash_equivalents"),
    inventory: find(all, "inventory"),
    receivables: find(all, "receivables"),
    fixedAssets: round2(find(all, "fixed_assets") + find(all, "intangible_assets")),
    investments: find(all, "long_term_investments"),
    payables: find(liab, "accounts_payable"),
    difference: sheet.difference,
  };
}

/** Day bounds from "yyyy-mm-dd" inputs, defaulting to the current financial year to date. */
export function periodFromInputs(from?: string | null, to?: string | null): { from: Date; to: Date } {
  const fy = financialYearIST();
  const f = from ? fromDateInput(from) : fy.start;
  const t = to ? endOfDayIST(fromDateInput(to)) : effectiveAsOf(null);
  return { from: f, to: t };
}

export type { Ledger };
export { builtInAncestors, builtInGroup };
