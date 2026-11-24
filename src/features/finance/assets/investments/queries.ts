import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { BankAccount, FileModel, Investment, User, type InvestmentDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { toFileDTO } from "@/features/files/server";
import type { GroupOption } from "@/features/finance/groups/types";
import { endOfDayIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { searchRegex } from "@/lib/list-params";
import type { InvestmentType } from "@/lib/constants";
import type { InvestmentDetail, InvestmentGroupNode, InvestmentList, InvestmentRow, InvestmentTotals } from "./types";

export const INVESTMENT_ROOT = "long_term_investments";

type Params = { q: string; filters: Record<string, string[]> };

function investmentFilter(params: Params, groups: GroupOption[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
  if (params.q) {
    const re = searchRegex(params.q);
    and.push({ $or: [{ name: re }, { institution: re }, { reference: re }, { notes: re }] });
  }
  const { group, type, status = [] } = params.filters;
  if (group?.length) filter.group = { $in: [...new Set(group.flatMap((g) => descendantsOf(groups, g)))] };
  if (type?.length) filter.type = { $in: type };
  if (!status.length) filter.archivedAt = null;
  else {
    const or: Record<string, unknown>[] = [];
    if (status.includes("held")) or.push({ archivedAt: null, redemption: { $exists: false } });
    if (status.includes("redeemed")) or.push({ archivedAt: null, redemption: { $exists: true } });
    if (status.includes("archived")) or.push({ archivedAt: { $ne: null } });
    if (or.length) and.push({ $or: or });
  }
  if (and.length) filter.$and = and;
  return filter;
}

async function accountNames(docs: InvestmentDoc[]) {
  const ids = [...new Set(docs.flatMap((d) => [idOf(d.account), idOf(d.redemption?.account)]).filter((v): v is string => Boolean(v)))];
  const accounts = ids.length ? await BankAccount.find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } }, { name: 1 }).lean() : [];
  return new Map(accounts.map((a) => [String(a._id), a.name]));
}

function toRow(v: InvestmentDoc, groups: Map<string, GroupOption>, accounts: Map<string, string>, asOf: Date): InvestmentRow {
  const ref = (id: unknown) => {
    const key = idOf(id as Types.ObjectId | null | undefined);
    return key ? { id: key, name: accounts.get(key) ?? "Account removed" } : null;
  };
  const redeemed = Boolean(v.redemption?.date && v.redemption.date.getTime() <= asOf.getTime());
  const group = groups.get(v.group);
  const currentValue = typeof v.currentValue === "number" ? round2(v.currentValue) : null;
  return {
    id: String(v._id),
    name: v.name,
    type: (v.type ?? "other") as InvestmentType,
    group: v.group,
    groupLabel: group?.label ?? "Group removed",
    groupPath: group?.path ?? v.group,
    institution: v.institution ?? null,
    reference: v.reference ?? null,
    purchaseDate: iso(v.purchaseDate)!,
    amount: round2(v.amount),
    account: ref(v.account),
    currentValue,
    valuedOn: iso(v.valuedOn),
    interestRate: v.interestRate ?? null,
    maturityDate: iso(v.maturityDate),
    unrealised: currentValue !== null && !redeemed ? round2(currentValue - v.amount) : null,
    redemption: v.redemption?.date
      ? {
          date: iso(v.redemption.date)!,
          amount: round2(v.redemption.amount),
          account: ref(v.redemption.account),
          notes: v.redemption.notes ?? null,
          gain: round2(v.redemption.amount - v.amount),
        }
      : null,
    held: !redeemed,
    archived: Boolean(v.archivedAt),
  };
}

const zero = (): InvestmentTotals => ({ count: 0, cost: 0, valuedCount: 0, valuedCost: 0, value: 0, redeemedCount: 0 });

function totalsOf(rows: InvestmentRow[]): InvestmentTotals {
  const t = zero();
  for (const r of rows) {
    if (!r.held) {
      t.redeemedCount += 1;
      continue;
    }
    t.count += 1;
    t.cost = round2(t.cost + r.amount);
    if (r.currentValue !== null) {
      t.valuedCount += 1;
      t.valuedCost = round2(t.valuedCost + r.amount);
      t.value = round2(t.value + r.currentValue);
    }
  }
  return t;
}

function addTotals(t: InvestmentTotals, o: InvestmentTotals) {
  t.count += o.count;
  t.redeemedCount += o.redeemedCount;
  t.valuedCount += o.valuedCount;
  t.cost = round2(t.cost + o.cost);
  t.valuedCost = round2(t.valuedCost + o.valuedCost);
  t.value = round2(t.value + o.value);
}

export async function listInvestments(params: Params): Promise<InvestmentList> {
  await connectDB();
  const groups = await loadFinanceGroups("asset", { includeArchived: true });
  const docs = await Investment.find(investmentFilter(params, groups)).sort({ purchaseDate: -1, _id: -1 }).lean();
  const accounts = await accountNames(docs);
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const asOf = endOfDayIST();
  const rows = docs.map((d) => toRow(d, byKey, accounts, asOf));
  const filtered = Boolean(params.q || Object.keys(params.filters).length);

  const byGroup = new Map<string, InvestmentRow[]>();
  for (const r of rows) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  const allowed = new Set(descendantsOf(groups, INVESTMENT_ROOT));
  const node = (g: GroupOption, depth: number): InvestmentGroupNode => {
    const children = groups
      .filter((c) => c.parent === g.key && (!c.archived || byGroup.has(c.key)))
      .map((c) => node(c, depth + 1));
    const own = byGroup.get(g.key) ?? [];
    const totals = totalsOf(own);
    for (const c of children) addTotals(totals, c.totals);
    return { key: g.key, label: g.label, depth, builtIn: g.builtIn, rows: own, children, totals };
  };
  const hasAny = (n: InvestmentGroupNode): boolean => n.rows.length > 0 || n.children.some(hasAny);
  const root = byKey.get(INVESTMENT_ROOT);
  const tree: InvestmentGroupNode[] = [];
  if (root) {
    if (byGroup.get(INVESTMENT_ROOT)?.length) {
      const own = byGroup.get(INVESTMENT_ROOT)!;
      tree.push({ key: INVESTMENT_ROOT, label: `${root.label}, no subgroup`, depth: 0, builtIn: true, rows: own, children: [], totals: totalsOf(own) });
    }
    for (const c of groups.filter((g) => g.parent === INVESTMENT_ROOT && (!g.archived || byGroup.has(g.key)))) tree.push(node(c, 0));
  }
  const orphans = rows.filter((r) => !allowed.has(r.group));
  if (orphans.length) tree.push({ key: "_unknown", label: "Other groups", depth: 0, builtIn: false, rows: orphans, children: [], totals: totalsOf(orphans) });
  return { rows, tree: filtered ? tree.filter(hasAny) : tree, totals: totalsOf(rows), filtered };
}

export async function getInvestment(id: string): Promise<InvestmentDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const v = await Investment.findById(id).lean();
  if (!v) return null;
  const [groups, accounts, files, creator] = await Promise.all([
    loadFinanceGroups("asset", { includeArchived: true }),
    accountNames([v]),
    FileModel.find({ "entity.type": "investment", "entity.id": v._id }).sort({ createdAt: -1 }).lean(),
    v.createdBy ? User.findById(v.createdBy, { name: 1 }).lean() : Promise.resolve(null),
  ]);
  return {
    ...toRow(v, new Map(groups.map((g) => [g.key, g])), accounts, endOfDayIST()),
    notes: v.notes ?? null,
    documents: files.map(toFileDTO),
    createdBy: creator ? { id: String(creator._id), name: creator.name ?? "" } : null,
    createdAt: iso(v.createdAt as Date)!,
    updatedAt: iso(v.updatedAt as Date)!,
  };
}
