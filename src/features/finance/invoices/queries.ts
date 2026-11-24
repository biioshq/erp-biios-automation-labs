import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Income, Invoice, Project, type IncomeDoc } from "@/server/models";
import { invoiceBalances, receivablesSummary, type ReceivableRow } from "@/server/finance/summaries";
import { idOf, iso } from "@/server/serialize";
import { getFiles } from "@/features/files/server";
import { dateRangeFilter, endOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import type { IncomeCategory, PaymentMethod } from "@/lib/constants";
import type { InvoiceListStatus } from "./schemas";
import type {
  InvoiceDetail,
  InvoiceListSummary,
  InvoicePaymentRow,
  InvoiceReceipt,
  InvoiceRow,
  OpenInvoiceOption,
  ProjectRef,
  UnlinkedReceipt,
} from "./types";

type PopulatedProject = { _id: Types.ObjectId; name: string; code?: string; color?: string } | null;

const toProjectRef = (p: PopulatedProject): ProjectRef | null =>
  p?._id ? { id: String(p._id), name: p.name, code: p.code ?? "", color: p.color ?? "#4a82cc" } : null;

/** Case-insensitive match on the whole name, so "Acme Ltd" also finds "acme ltd". */
export function exactName(name: string): RegExp {
  return new RegExp(`^${searchRegex(name.trim()).source}$`, "i");
}

const oids = (ids: string[]) => ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

/** Mongo filter on the invoice itself (search, client, project, date). Status is computed afterwards. */
function invoiceFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (params.q) {
    const re = searchRegex(params.q);
    filter.$or = [{ number: re }, { client: re }, { clientGstin: re }];
  }
  if (params.filters.client?.length) filter.client = { $in: params.filters.client.map(exactName) };
  if (params.filters.project?.length) {
    const ids = oids(params.filters.project);
    filter.project = params.filters.project.includes("none") ? { $in: [...ids, null] } : { $in: ids };
  }
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.date = range;
  return filter;
}

/** Cancelled invoices in the same shape as invoiceBalances rows (nothing is owed on them). */
async function cancelledRows(filter: Record<string, unknown>): Promise<(Omit<ReceivableRow, "status"> & { status: InvoiceListStatus })[]> {
  const docs = await Invoice.find({ ...filter, status: "cancelled" }, { number: 1, client: 1, project: 1, date: 1, dueDate: 1, total: 1 }).lean();
  return docs.map((i) => ({
    id: String(i._id),
    number: i.number,
    client: i.client,
    project: i.project ? String(i.project) : null,
    date: toDateInput(i.date),
    dueDate: i.dueDate ? toDateInput(i.dueDate) : null,
    total: i.total,
    received: 0,
    outstanding: 0,
    credit: 0,
    status: "cancelled",
  }));
}

type BalanceRow = Omit<ReceivableRow, "status"> & { status: InvoiceListStatus };

function compareRows(sort: ListParams["sort"]) {
  const id = sort?.id ?? "date";
  const dir = sort?.desc === false ? 1 : -1;
  return (a: BalanceRow, b: BalanceRow) => {
    let c = 0;
    if (id === "total" || id === "outstanding") c = a[id] - b[id];
    else if (id === "client" || id === "number") c = a[id].localeCompare(b[id], "en-IN", { numeric: true, sensitivity: "base" });
    else if (id === "dueDate") c = (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    else c = a.date.localeCompare(b.date);
    return c * dir || b.number.localeCompare(a.number, "en-IN", { numeric: true });
  };
}

/**
 * The invoice list. Status, received and outstanding come from invoiceBalances, so the list is
 * filtered by status after they are computed and paginated here (invoices number in the hundreds).
 */
export async function listInvoices(params: ListParams, now: Date = new Date()): Promise<Paginated<InvoiceRow> & { summary: InvoiceListSummary }> {
  await connectDB();
  const filter = invoiceFilter(params);
  const statuses = params.filters.status ?? [];
  const wantCancelled = !statuses.length || statuses.includes("cancelled");
  const wantOpen = !statuses.length || statuses.some((s) => s !== "cancelled");
  const [open, cancelled] = await Promise.all([
    wantOpen ? invoiceBalances(now, filter) : Promise.resolve([]),
    wantCancelled ? cancelledRows(filter) : Promise.resolve([]),
  ]);
  const all: BalanceRow[] = [...open, ...cancelled].filter((r) => !statuses.length || statuses.includes(r.status));
  all.sort(compareRows(params.sort));
  const live = all.filter((r) => r.status !== "cancelled");
  const summary: InvoiceListSummary = {
    count: all.length,
    invoiced: round2(live.reduce((s, r) => s + r.total, 0)),
    received: round2(live.reduce((s, r) => s + r.received, 0)),
    outstanding: round2(live.reduce((s, r) => s + r.outstanding, 0)),
  };
  const pageRows = all.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);
  const [projects, files] = await Promise.all([
    Project.find({ _id: { $in: oids(pageRows.map((r) => r.project).filter((p): p is string => Boolean(p))) } }, { name: 1, code: 1, color: 1 }).lean(),
    Invoice.find({ _id: { $in: oids(pageRows.map((r) => r.id)) }, file: { $ne: null } }, { _id: 1 }).lean(),
  ]);
  const projectById = new Map(projects.map((p) => [String(p._id), toProjectRef(p as PopulatedProject)]));
  const withFile = new Set(files.map((f) => String(f._id)));
  return {
    rows: pageRows.map((r) => ({
      id: r.id,
      number: r.number,
      client: r.client,
      project: r.project ? (projectById.get(r.project) ?? null) : null,
      date: r.date,
      dueDate: r.dueDate,
      total: r.total,
      received: r.received,
      outstanding: r.outstanding,
      credit: r.credit ?? 0,
      status: r.status,
      hasFile: withFile.has(r.id),
    })),
    total: all.length,
    page: params.page,
    pageSize: params.pageSize,
    summary,
  };
}

/** Headline figures for the invoices page: receivables as of today and advances not yet applied. */
export async function invoiceStats(now: Date = new Date()) {
  await connectDB();
  const [receivables, advances] = await Promise.all([
    receivablesSummary(now),
    Income.aggregate<{ total: number; count: number }>([
      { $match: { category: "advance", invoice: null } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  return {
    outstanding: receivables.total,
    openCount: receivables.count,
    overdue: receivables.overdue,
    overdueCount: receivables.overdueCount,
    dueSoon: receivables.dueSoon,
    advances: round2(advances[0]?.total ?? 0),
    advanceCount: advances[0]?.count ?? 0,
  };
}

type PopulatedAccount = { _id: Types.ObjectId; name: string } | null;

function toReceipt(i: IncomeDoc & { account?: unknown }): InvoiceReceipt {
  const account = i.account as PopulatedAccount;
  return {
    id: String(i._id),
    number: i.number,
    client: i.client,
    category: i.category as IncomeCategory,
    amount: i.amount,
    date: iso(i.date)!,
    paymentMethod: i.paymentMethod as PaymentMethod,
    account: account?._id ? { id: String(account._id), name: account.name } : null,
    reference: i.reference ?? null,
  };
}

/** Balance of one invoice the way invoiceBalances computes it; cancelled ones owe nothing. */
async function balanceOf(id: Types.ObjectId, now: Date): Promise<BalanceRow | null> {
  const [row] = await invoiceBalances(now, { _id: id });
  if (row) return row;
  const [cancelled] = await cancelledRows({ _id: id });
  return cancelled ?? null;
}

export async function getInvoice(id: string, now: Date = new Date()): Promise<InvoiceDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const inv = await Invoice.findById(id).populate("project", "name code color").populate("createdBy", "name").lean();
  if (!inv) return null;
  const [balance, receipts, files] = await Promise.all([
    balanceOf(inv._id, now),
    Income.find({ invoice: inv._id }).sort({ date: 1, _id: 1 }).populate("account", "name").lean(),
    inv.file ? getFiles([inv.file]) : Promise.resolve([]),
  ]);
  const creator = inv.createdBy as unknown as { _id: Types.ObjectId; name?: string } | null;
  const last = receipts.reduce<Date | null>((d, r) => (!d || r.date.getTime() > d.getTime() ? r.date : d), null);
  return {
    id: String(inv._id),
    number: inv.number,
    client: inv.client,
    project: toProjectRef(inv.project as unknown as PopulatedProject),
    date: iso(inv.date)!,
    dueDate: iso(inv.dueDate ?? null),
    total: inv.total,
    received: balance?.received ?? 0,
    outstanding: balance?.outstanding ?? 0,
    credit: balance?.credit ?? 0,
    status: inv.status === "cancelled" ? "cancelled" : (balance?.status ?? "unpaid"),
    hasFile: Boolean(inv.file),
    clientGstin: inv.clientGstin ?? null,
    interState: Boolean(inv.interState),
    lines: (inv.lines ?? []).map((l) => ({
      description: l.description,
      quantity: l.quantity ?? 0,
      rate: l.rate ?? 0,
      amount: l.amount ?? 0,
      gstRate: l.gstRate ?? 0,
      hsnSac: l.hsnSac ?? null,
    })),
    taxableAmount: inv.taxableAmount ?? 0,
    cgst: inv.cgst ?? 0,
    sgst: inv.sgst ?? 0,
    igst: inv.igst ?? 0,
    notes: inv.notes ?? null,
    file: files[0] ?? null,
    receipts: receipts.map(toReceipt),
    lastReceivedOn: iso(last),
    createdBy: creator?._id ? { id: idOf(creator._id)!, name: creator.name ?? "" } : null,
    createdAt: iso(inv.createdAt as Date)!,
    updatedAt: iso(inv.updatedAt as Date)!,
  };
}

/**
 * Open invoices of a client or a project, for linking a receipt. When an income record is being
 * edited, its own amount is added back to the invoice it is linked to, so the figure is what was
 * outstanding before this receipt. That invoice is always included, even when this receipt paid it off.
 */
export async function openInvoicesFor(
  input: { client?: string; projectId?: string; excludeIncomeId?: string },
  now: Date = new Date(),
): Promise<OpenInvoiceOption[]> {
  await connectDB();
  const or: Record<string, unknown>[] = [];
  if (input.client?.trim()) or.push({ client: exactName(input.client) });
  if (input.projectId && Types.ObjectId.isValid(input.projectId)) or.push({ project: new Types.ObjectId(input.projectId) });
  const own =
    input.excludeIncomeId && Types.ObjectId.isValid(input.excludeIncomeId)
      ? await Income.findById(input.excludeIncomeId, { invoice: 1, amount: 1 }).lean()
      : null;
  if (own?.invoice) or.push({ _id: own.invoice });
  if (!or.length) return [];
  const rows = await invoiceBalances(now, { $or: or });
  const ownInvoice = own?.invoice ? String(own.invoice) : null;
  const projectIds = oids(rows.map((r) => r.project).filter((p): p is string => Boolean(p)));
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { name: 1 }).lean() : [];
  const projectName = new Map(projects.map((p) => [String(p._id), p.name]));
  return rows
    .map((r) => {
      const outstanding = r.id === ownInvoice ? round2(Math.max(0, r.total - (r.received - own!.amount))) : r.outstanding;
      return {
        id: r.id,
        number: r.number,
        client: r.client,
        date: r.date,
        dueDate: r.dueDate,
        total: r.total,
        outstanding,
        status: r.status,
        project: r.project ? { id: r.project, name: projectName.get(r.project) ?? "Project" } : null,
      };
    })
    .filter((r) => r.outstanding > 0 || r.id === ownInvoice)
    .sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date));
}

/** Receipts of a client not linked to any invoice, advances first, for "Apply advance". */
export async function unlinkedReceiptsFor(client: string, projectId?: string | null): Promise<UnlinkedReceipt[]> {
  await connectDB();
  const or: Record<string, unknown>[] = [{ client: exactName(client) }];
  if (projectId && Types.ObjectId.isValid(projectId)) or.push({ project: new Types.ObjectId(projectId) });
  // "From stock" moves no money and "On credit" is not money received, so neither can settle an invoice.
  // Future-dated receipts are left out too: they cannot settle an invoice before their date.
  const docs = await Income.find({
    invoice: null,
    category: { $nin: ["interest", "grant"] },
    paymentMethod: { $nin: ["stock", "credit"] },
    date: { $lte: endOfDayIST(new Date()) },
    $or: or,
  })
    .sort({ date: -1 })
    .limit(100)
    .populate("project", "name")
    .lean();
  return docs
    .map((i) => {
      const project = i.project as unknown as PopulatedProject;
      return {
        id: String(i._id),
        number: i.number,
        category: i.category as IncomeCategory,
        amount: i.amount,
        date: iso(i.date)!,
        reference: i.reference ?? null,
        project: project?._id ? { id: String(project._id), name: project.name } : null,
      };
    })
    .sort((a, b) => Number(b.category === "advance") - Number(a.category === "advance"));
}

/** The "Payments received" tab: every receipt linked to an invoice, with what is still pending on it. */
export async function listInvoicePayments(params: ListParams, now: Date = new Date()): Promise<Paginated<InvoicePaymentRow> & { summary: { count: number; total: number } }> {
  await connectDB();
  const filter: Record<string, unknown> = { invoice: { $ne: null } };
  if (params.q) {
    const re = searchRegex(params.q);
    const matching = await Invoice.find({ number: re }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ client: re }, { number: re }, { reference: re }, { invoice: { $in: matching.map((m) => m._id) } }];
  }
  if (params.filters.client?.length) filter.client = { $in: params.filters.client.map(exactName) };
  if (params.filters.paymentMethod?.length) filter.paymentMethod = { $in: params.filters.paymentMethod };
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.date = range;

  const [docs, total, sum] = await Promise.all([
    Income.find(filter)
      .sort(mongoSort(params.sort ?? { id: "date", desc: true }))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate("account", "name")
      .populate("project", "name color")
      .lean(),
    Income.countDocuments(filter),
    Income.aggregate<{ total: number }>([{ $match: filter }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);
  const invoiceIds = oids([...new Set(docs.map((d) => String(d.invoice)))]);
  const [open, cancelled] = invoiceIds.length
    ? await Promise.all([invoiceBalances(now, { _id: { $in: invoiceIds } }), cancelledRows({ _id: { $in: invoiceIds } })])
    : [[], []];
  const balances = new Map<string, BalanceRow>([...open, ...cancelled].map((b) => [b.id, b]));
  return {
    rows: docs.map((d) => {
      const b = balances.get(String(d.invoice));
      const project = d.project as unknown as PopulatedProject;
      return {
        ...toReceipt(d),
        invoice: b ? { id: b.id, number: b.number, total: b.total, outstanding: b.outstanding, status: b.status } : null,
        project: project?._id ? { id: String(project._id), name: project.name, color: project.color ?? "#4a82cc" } : null,
      };
    }),
    total,
    page: params.page,
    pageSize: params.pageSize,
    summary: { count: total, total: round2(sum[0]?.total ?? 0) },
  };
}

/** Customer names on invoices, for the client filter. */
export async function getInvoiceClients(): Promise<string[]> {
  await connectDB();
  const names = (await Invoice.distinct("client")) as string[];
  return names.filter(Boolean).sort((a, b) => a.localeCompare(b, "en-IN", { sensitivity: "base" }));
}
