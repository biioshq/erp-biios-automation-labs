import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { CapitalEntry, EquityHolder, type CapitalEntryDoc } from "@/server/models";
import { iso } from "@/server/serialize";
import { getFiles } from "@/features/files/server";
import { equityOverview } from "@/server/finance/summaries";
import { profitAndLoss, trialBalance } from "@/server/accounting/statements";
import { ledgerAsOf } from "@/server/accounting/ledger";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { getBankAccountOptions } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { endOfDayIST, financialYearIST, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { CapitalEntryType, EquityHolderKind, InvestorInstrument, PaymentMethod } from "@/lib/constants";
import type { EntryDetail, EntryRow, HolderDetail, HolderOption, HolderRow, ReserveRow, RetainedYear } from "./types";

/**
 * Reads for the Capital / Equity pages. Totals come from the shared engine (equityOverview and the
 * ledger), so every figure here is the one the balance sheet shows.
 */

type PopulatedHolder = { _id: Types.ObjectId; name: string; kind: EquityHolderKind } | null;
type PopulatedAccount = { _id: Types.ObjectId; name: string } | null;
type EntryLean = CapitalEntryDoc & { holder?: unknown; account?: unknown };

const today = () => endOfDayIST(new Date());

/** Labels of every equity group, archived ones too (old entries may point at them). */
async function groupLabels(): Promise<Map<string, string>> {
  const groups = await loadFinanceGroups("equity", { includeArchived: true });
  return new Map(groups.map((g) => [g.key, g.label]));
}

function toEntryRow(e: EntryLean, labels: Map<string, string>): EntryRow {
  const holder = e.holder as PopulatedHolder;
  const account = e.account as PopulatedAccount;
  return {
    id: String(e._id),
    number: e.number,
    type: e.type as CapitalEntryType,
    date: iso(e.date)!,
    amount: e.amount,
    holder: holder?._id ? { id: String(holder._id), name: holder.name, kind: holder.kind } : null,
    initial: typeof e.initial === "boolean" ? e.initial : null,
    instrument: (e.instrument as InvestorInstrument | undefined) ?? null,
    reserveGroup: e.reserveGroup ? { key: e.reserveGroup, label: labels.get(e.reserveGroup) ?? "Reserve no longer listed" } : null,
    paymentMethod: (e.paymentMethod as PaymentMethod | undefined) ?? null,
    account: account?._id ? { id: String(account._id), name: account.name } : null,
    reference: e.reference ?? null,
    purpose: e.purpose ?? null,
    documents: e.documents?.length ?? 0,
  };
}

export type EntryFilter = { types?: CapitalEntryType[]; holderKind?: EquityHolderKind; holderId?: string; limit?: number };

/** Capital entries, newest first. */
export async function listEntries(filter: EntryFilter = {}): Promise<EntryRow[]> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (filter.types?.length) query.type = { $in: filter.types };
  if (filter.holderId) {
    if (!Types.ObjectId.isValid(filter.holderId)) return [];
    query.holder = new Types.ObjectId(filter.holderId);
  } else if (filter.holderKind) query.holder = { $in: await EquityHolder.distinct("_id", { kind: filter.holderKind }) };
  const [docs, labels] = await Promise.all([
    CapitalEntry.find(query as QueryFilter<CapitalEntryDoc>)
      .sort({ date: -1, createdAt: -1 })
      .limit(filter.limit ?? 1000)
      .populate("holder", "name kind")
      .populate("account", "name")
      .lean(),
    groupLabels(),
  ]);
  return docs.map((d) => toEntryRow(d, labels));
}

export async function getEntry(id: string): Promise<EntryDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const [e, labels] = await Promise.all([
    CapitalEntry.findById(id).populate("holder", "name kind").populate("account", "name").populate("createdBy", "name").lean(),
    groupLabels(),
  ]);
  if (!e) return null;
  const files = await getFiles(e.documents ?? []);
  const creator = e.createdBy as unknown as { _id: Types.ObjectId; name?: string } | null;
  return {
    ...toEntryRow(e, labels),
    notes: e.notes ?? null,
    files,
    fromBankStatement: Boolean(e.bankTransaction),
    bankTransactionId: e.bankTransaction ? String(e.bankTransaction) : null,
    createdBy: creator?._id ? { id: String(creator._id), name: creator.name ?? "" } : null,
    createdAt: iso(e.createdAt as Date)!,
    updatedAt: iso(e.updatedAt as Date)!,
  };
}

/* Owners and investors */

/** Every holder with totals from equityOverview, plus the fields the pages show. */
async function holderRows(overview?: Awaited<ReturnType<typeof equityOverview>>): Promise<HolderRow[]> {
  await connectDB();
  const [o, docs, counts] = await Promise.all([
    overview ?? equityOverview(),
    EquityHolder.find({}, { instrument: 1 }).lean(),
    CapitalEntry.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { holder: { $ne: null } } }, { $group: { _id: "$holder", n: { $sum: 1 } } }]),
  ]);
  const instrument = new Map(docs.map((d) => [String(d._id), (d.instrument as InvestorInstrument | undefined) ?? null]));
  const count = new Map(counts.map((c) => [String(c._id), c.n]));
  return o.holders.map((h) => ({ ...h, instrument: instrument.get(h.id) ?? null, entries: count.get(h.id) ?? 0 }));
}

export async function getHolders(kind: EquityHolderKind): Promise<HolderRow[]> {
  const rows = await holderRows();
  // Active first, then by name (equityOverview already sorts by name).
  return rows.filter((h) => h.kind === kind).sort((a, b) => Number(a.archived) - Number(b.archived));
}

export async function getHolder(id: string): Promise<HolderDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const doc = await EquityHolder.findById(id).lean();
  if (!doc) return null;
  const [rows, history] = await Promise.all([holderRows(), listEntries({ holderId: id })]);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  return {
    ...row,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    notes: doc.notes ?? null,
    createdAt: iso(doc.createdAt as Date)!,
    history,
  };
}

export async function getHolderOptions(): Promise<HolderOption[]> {
  await connectDB();
  const docs = await EquityHolder.find({}, { name: 1, kind: 1, instrument: 1, archivedAt: 1 }).sort({ name: 1 }).lean();
  return docs.map((d) => ({
    value: String(d._id),
    label: d.name,
    kind: d.kind as EquityHolderKind,
    instrument: (d.instrument as InvestorInstrument | undefined) ?? null,
    archived: Boolean(d.archivedAt),
  }));
}

/* Reserves */

/** Reserve groups (General reserve, Other reserves and subgroups) and the parents a new subgroup can go under. */
export async function getReserveGroups(): Promise<{ groups: GroupOption[]; parents: GroupOption[] }> {
  const all = await loadFinanceGroups("equity");
  const keys = new Set(descendantsOf(all, "reserves_surplus"));
  const parents = all.filter((g) => keys.has(g.key));
  return { groups: parents.filter((g) => g.key !== "reserves_surplus"), parents };
}

/** Each reserve's balance from the ledger as of today (credit balance shown positive). */
export async function getReserves(): Promise<{ rows: ReserveRow[]; total: number; parents: GroupOption[] }> {
  await connectDB();
  const [{ groups, parents }, tb, transfers] = await Promise.all([
    getReserveGroups(),
    trialBalance(new Date()),
    CapitalEntry.aggregate<{ _id: string; n: number }>([{ $match: { type: "reserve_transfer" } }, { $group: { _id: "$reserveGroup", n: { $sum: 1 } } }]),
  ]);
  const balance = new Map<string, number>();
  for (const r of tb.rows) if (r.code.startsWith("reserve:")) balance.set(r.code.slice("reserve:".length), round2(r.credit - r.debit));
  const count = new Map(transfers.map((t) => [t._id, t.n]));
  // A balance on the heading itself (only possible from older data) is still shown, so the total adds up.
  const listed = [...(balance.has("reserves_surplus") ? parents.filter((p) => p.key === "reserves_surplus") : []), ...groups];
  const rows: ReserveRow[] = listed.map((g) => ({
    key: g.key,
    label: g.label,
    parent: g.parent,
    depth: Math.max(0, g.depth - 1),
    builtIn: g.builtIn,
    description: g.description,
    balance: balance.get(g.key) ?? 0,
    transfers: count.get(g.key) ?? 0,
  }));
  const total = round2([...balance.values()].reduce((s, v) => s + v, 0));
  return { rows, total, parents };
}

/* Summary */

export async function getEquitySummary() {
  const overview = await equityOverview();
  const [holders, latest] = await Promise.all([holderRows(overview), listEntries({ limit: 10 })]);
  return { overview, holders, latest };
}

/* Retained earnings */

export type RetainedEarnings = {
  /** Retained earnings on the balance sheet today. */
  balance: number;
  earlierYears: number;
  currentYear: number;
  currentYearLabel: string;
  /** Opening figures dated before the day of the first record. */
  beforeBooks: number;
  /** The day before the first profit or loss record, dividend or reserve transfer: the date an opening figure takes. */
  openingDate: string | null;
  years: RetainedYear[];
  /** Roll-forward closing less the balance sheet figure; zero when they agree. */
  difference: number;
  dividends: number;
  toReserves: number;
  entries: EntryRow[];
};

/**
 * Retained earnings year by year: the opening figure, each financial year's profit or loss from the
 * P&L, less dividends and transfers to reserves. The last closing figure is the balance sheet line.
 */
export async function getRetainedEarnings(): Promise<RetainedEarnings> {
  await connectDB();
  const now = new Date();
  const [overview, ledger, entries] = await Promise.all([
    equityOverview(now),
    ledgerAsOf(now),
    listEntries({ types: ["opening_retained", "dividend", "reserve_transfer"] }),
  ]);
  const asOf = today();
  const counted = entries.filter((e) => new Date(e.date).getTime() <= asOf.getTime());
  const firstPl = ledger.postings.find((p) => {
    const type = ledger.accounts.get(p.account)?.type;
    return type === "income" || type === "expense";
  })?.date;
  // The books start in the first year with a profit or loss, a dividend or a reserve transfer.
  const starts = [firstPl, ...counted.filter((e) => e.type !== "opening_retained").map((e) => new Date(e.date))].filter((d): d is Date => Boolean(d));
  const first = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;

  const fys: { start: Date; end: Date; label: string }[] = [];
  if (first) {
    let fy = financialYearIST(first);
    const current = financialYearIST(asOf);
    while (fy.start.getTime() <= current.start.getTime()) {
      fys.push(fy);
      fy = financialYearIST(new Date(fy.end.getTime() + 1));
    }
  }
  // The opening figure is dated the day before the first record (the form says so), which is usually
  // inside the first financial year. Anything dated before the first record's day is the figure from
  // before the books; opening figures entered later are corrections in their year.
  const booksStart = first ? startOfDayIST(first).getTime() : Infinity;
  const isBeforeBooks = (e: EntryRow) => e.type === "opening_retained" && new Date(e.date).getTime() < booksStart;
  const beforeBooks = round2(counted.filter(isBeforeBooks).reduce((s, e) => s + e.amount, 0));
  const profits = await Promise.all(fys.map((fy) => profitAndLoss(fy.start, fy.end.getTime() > asOf.getTime() ? asOf : fy.end)));

  let running = beforeBooks;
  const years: RetainedYear[] = fys.map((fy, i) => {
    const inYear = counted.filter((e) => {
      const t = new Date(e.date).getTime();
      return t >= fy.start.getTime() && t <= fy.end.getTime() && !isBeforeBooks(e);
    });
    const sum = (type: CapitalEntryType) => round2(inYear.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0));
    const opening = running;
    const profit = profits[i].profit;
    const adjustments = sum("opening_retained");
    const dividends = sum("dividend");
    const toReserves = sum("reserve_transfer");
    running = round2(opening + profit + adjustments - dividends - toReserves);
    return {
      label: fy.label,
      from: toDateInput(fy.start),
      to: toDateInput(fy.end.getTime() > asOf.getTime() ? asOf : fy.end),
      opening,
      profit,
      adjustments,
      dividends,
      toReserves,
      closing: running,
      current: i === fys.length - 1,
    };
  });

  const line = overview.retainedLine;
  const child = (key: string) => line?.children?.find((c) => c.key === key)?.amount ?? 0;
  const balance = overview.retainedEarnings;
  const closing = years.length ? years[years.length - 1].closing : beforeBooks;
  return {
    balance,
    earlierYears: child("retained_previous"),
    currentYear: child("retained_year"),
    currentYearLabel: financialYearIST(asOf).label,
    beforeBooks,
    openingDate: first ? toDateInput(new Date(startOfDayIST(first).getTime() - 12 * 3_600_000)) : null,
    years: years.reverse(),
    difference: round2(closing - balance),
    dividends: round2(counted.filter((e) => e.type === "dividend").reduce((s, e) => s + e.amount, 0)),
    toReserves: round2(counted.filter((e) => e.type === "reserve_transfer").reduce((s, e) => s + e.amount, 0)),
    entries,
  };
}

/** What the equity drawers need on every page: people, accounts and reserves for the pickers. */
export async function getPanelData() {
  const [holders, accounts, reserves] = await Promise.all([getHolderOptions(), getBankAccountOptions(), getReserveGroups()]);
  return { holders, accounts, reserveGroups: reserves.groups, reserveParents: reserves.parents };
}
