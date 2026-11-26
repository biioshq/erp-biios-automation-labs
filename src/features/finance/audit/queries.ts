import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { AuditLog, BankAccount, Invoice, Project, type AuditLogDoc } from "@/server/models";
import { can, type SessionUser } from "@/server/auth/session";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { dateRangeFilter, fromDateInput } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import { searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { DEPARTMENTS, INCOME_CATEGORIES, PAYMENT_METHODS, PROJECT_STAGES, labelOf } from "@/lib/constants";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUDIT_FIELDS,
  AUDIT_SOURCES,
  auditLabel,
  type AuditAction,
  type AuditEntityType,
  type AuditRow,
  type AuditSource,
} from "@/lib/audit";

/**
 * Reading the audit trail: the Audit trail page and the History sections. People without the
 * salaries permission never get salary entries.
 */

/** Salary entries only for people who may see salaries. */
const salaryScope = (user: SessionUser) => (can(user, "data.salaries") ? {} : { salary: { $ne: true } });

/** The page each record type opens on: its entries need that page too, as its History does. */
const TYPE_PERMISSION: Record<AuditEntityType, string> = {
  expense: "finance.expenses:view",
  income: "finance.income:view",
  invoice: "finance.invoices:view",
  capital_entry: "finance.equity:view",
  liability: "finance.liabilities:view",
  account_transfer: "finance.cash_bank:view",
  bank_party_rule: "finance.bank_statements:view",
  expense_category: "finance.expenses:view",
};

/** The record types this person may read entries of. */
export const visibleAuditTypes = (user: SessionUser) => AUDIT_ENTITY_TYPES.map((t) => t.value).filter((t) => can(user, TYPE_PERMISSION[t]));

/** Salary scope plus the record types the person may see; an empty list matches nothing. */
const scopeOf = (user: SessionUser, only?: string[]): Record<string, unknown> => {
  const allowed: string[] = visibleAuditTypes(user);
  const types = only?.length ? allowed.filter((t) => only.includes(t)) : allowed;
  return { ...salaryScope(user), "entity.type": { $in: types } };
};

const SYSTEM_ACTOR = "system";

/** Where an entry's record opens. Deleted records still link; the page says when it is gone. */
function hrefOf(type: string, id: string): string | null {
  switch (type) {
    case "expense":
      return `/finance/expenses?view=${id}`;
    case "income":
      return `/finance/income?view=${id}`;
    case "invoice":
      return `/finance/invoices?view=${id}`;
    case "capital_entry":
      return `/finance/equity?view=${id}`;
    case "liability":
      return `/finance/liabilities/loans?view=${id}`;
    case "account_transfer":
      return "/finance/assets/cash";
    case "bank_party_rule":
      return "/finance/bank-statements";
    case "expense_category":
      return "/finance/expenses";
    default:
      return null;
  }
}

type Lookups = {
  category: (v: string) => string;
  projects: Map<string, string>;
  accounts: Map<string, string>;
  invoices: Map<string, string>;
};

/** A stored id (24 hex digits). Invoice entries also hold invoice numbers, which are never ids. */
const isOid = (v: string) => /^[a-f\d]{24}$/i.test(v);

async function lookupsFor(docs: AuditLogDoc[]): Promise<Lookups> {
  const projectIds = new Set<string>();
  const accountIds = new Set<string>();
  const invoiceIds = new Set<string>();
  for (const d of docs) {
    for (const c of d.changes ?? []) {
      const kind = AUDIT_FIELDS[c.field]?.kind;
      for (const v of [c.from, c.to]) {
        if (typeof v !== "string" || !Types.ObjectId.isValid(v)) continue;
        if (kind === "project") projectIds.add(v);
        if (kind === "account") accountIds.add(v);
        if (kind === "invoice" && isOid(v)) invoiceIds.add(v);
      }
    }
  }
  const oids = (s: Set<string>) => [...s].map((id) => new Types.ObjectId(id));
  const [labeler, projects, accounts, invoices] = await Promise.all([
    getExpenseCategoryLabeler(),
    projectIds.size ? Project.find({ _id: { $in: oids(projectIds) } }, { name: 1 }).lean() : Promise.resolve([]),
    accountIds.size ? BankAccount.find({ _id: { $in: oids(accountIds) } }, { name: 1 }).lean() : Promise.resolve([]),
    invoiceIds.size ? Invoice.find({ _id: { $in: oids(invoiceIds) } }, { number: 1 }).lean() : Promise.resolve([]),
  ]);
  return {
    category: (v) => labeler(v),
    projects: new Map(projects.map((p) => [String(p._id), p.name])),
    accounts: new Map(accounts.map((a) => [String(a._id), a.name])),
    invoices: new Map(invoices.map((i) => [String(i._id), i.number])),
  };
}

const asDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? fromDateInput(v) : new Date(v));

/** A stored value as people read it. */
function show(field: string, v: unknown, l: Lookups): string | null {
  if (v === null || v === undefined || v === "") return null;
  const kind = AUDIT_FIELDS[field]?.kind ?? "text";
  const s = String(v);
  switch (kind) {
    case "money":
      return typeof v === "number" ? formatCurrency(v, { exact: true }) : s;
    case "date":
      return formatDate(asDay(s));
    case "bool":
      return v === true ? "Yes" : v === false ? "No" : s;
    case "category":
      return l.category(s);
    case "incomeCategory":
      return labelOf(INCOME_CATEGORIES, s as (typeof INCOME_CATEGORIES)[number]["value"]) || s;
    case "project":
      return l.projects.get(s) ?? "A removed project";
    case "account":
      return l.accounts.get(s) ?? "A removed account";
    case "invoice":
      // Edits store the invoice's id; links made from an invoice or a statement store its number.
      return isOid(s) ? (l.invoices.get(s) ?? "A removed invoice") : s;
    case "stage":
      return labelOf(PROJECT_STAGES, s as (typeof PROJECT_STAGES)[number]["value"]) || s;
    case "method":
      return labelOf(PAYMENT_METHODS, s as (typeof PAYMENT_METHODS)[number]["value"]) || s;
    case "department":
      return labelOf(DEPARTMENTS, s as (typeof DEPARTMENTS)[number]["value"]) || s;
    default:
      return s;
  }
}

function toRow(d: AuditLogDoc, l: Lookups): AuditRow {
  const type = d.entity.type as AuditEntityType;
  return {
    id: String(d._id),
    at: d.at.toISOString(),
    actor: d.actor?.name ?? "Unknown",
    action: d.action as AuditAction,
    actionLabel: auditLabel(AUDIT_ACTIONS, d.action),
    source: d.source as AuditSource,
    sourceLabel: auditLabel(AUDIT_SOURCES, d.source),
    entityType: type,
    entityTypeLabel: auditLabel(AUDIT_ENTITY_TYPES, type),
    entityId: d.entity.id,
    entityLabel: d.entity.label ?? auditLabel(AUDIT_ENTITY_TYPES, type),
    href: hrefOf(type, d.entity.id),
    changes: (d.changes ?? []).map((c) => ({
      field: c.field,
      label: AUDIT_FIELDS[c.field]?.label ?? c.field,
      from: show(c.field, c.from, l),
      to: show(c.field, c.to, l),
    })),
    note: d.note ?? null,
  };
}

export const AUDIT_SORT = { at: -1 as const, _id: -1 as const };

function filterOf(params: Pick<ListParams, "q" | "filters" | "from" | "to">, user: SessionUser) {
  const { filters } = params;
  const f: Record<string, unknown> = scopeOf(user, filters.type);
  if (filters.action?.length) f.action = { $in: filters.action };
  if (filters.source?.length) f.source = { $in: filters.source };
  if (filters.actor?.length) {
    const ids = filters.actor.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const or: Record<string, unknown>[] = [];
    if (ids.length) or.push({ "actor.id": { $in: ids } });
    if (filters.actor.includes(SYSTEM_ACTOR)) or.push({ "actor.id": { $exists: false } });
    f.$and = [{ $or: or.length ? or : [{ _id: null }] }];
  }
  if (params.q) {
    const re = searchRegex(params.q);
    f.$or = [{ "entity.label": re }, { "actor.name": re }, { note: re }];
  }
  const range = dateRangeFilter(params.from, params.to);
  if (range) f.at = range;
  return f;
}

/** One page of the Audit trail. */
export async function listAuditLogs(params: ListParams, user: SessionUser): Promise<Paginated<AuditRow>> {
  await connectDB();
  const filter = filterOf(params, user);
  const [docs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort(params.sort?.id === "at" && !params.sort.desc ? { at: 1, _id: 1 } : AUDIT_SORT)
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  const lookups = await lookupsFor(docs);
  return { rows: docs.map((d) => toRow(d, lookups)), total, page: params.page, pageSize: params.pageSize };
}

/** The people who appear in the trail, for the Person filter. "System" stands for scheduled postings. */
export async function auditActors(user: SessionUser): Promise<{ value: string; label: string }[]> {
  await connectDB();
  const rows = await AuditLog.aggregate<{ _id: Types.ObjectId | null; name: string }>([
    { $match: scopeOf(user) },
    { $sort: { at: -1 } },
    { $group: { _id: { $ifNull: ["$actor.id", null] }, name: { $first: "$actor.name" } } },
    { $limit: 300 },
  ]);
  return rows
    .map((r) => ({ value: r._id ? String(r._id) : SYSTEM_ACTOR, label: r._id ? r.name : "System (scheduled)" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The History of one record, newest first. */
export async function entityHistory(type: AuditEntityType, id: string, user: SessionUser, limit = 100): Promise<AuditRow[]> {
  await connectDB();
  const docs = await AuditLog.find({ ...scopeOf(user, [type]), "entity.id": id })
    .sort(AUDIT_SORT)
    .limit(limit)
    .lean();
  const lookups = await lookupsFor(docs);
  return docs.map((d) => toRow(d, lookups));
}
