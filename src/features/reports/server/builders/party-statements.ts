import "server-only";

import { connectDB } from "@/server/db";
import { Expense, Income, Invoice } from "@/server/models";
import { salaryScope } from "@/server/auth/session";
import { invoiceBalances } from "@/server/finance/summaries";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { exactName } from "@/features/finance/invoices/queries";
import { effectivePayments, maybeUnpaidFilter, paymentState } from "@/lib/payments";
import { INCOME_CATEGORIES, PAYMENT_METHODS, PAYMENT_STATUSES, labelOf, type IncomeCategory, type PaymentMethod, type PaymentStatus } from "@/lib/constants";
import { financialYearIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { col, day, periodText, rangeOf, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/**
 * Vendor and customer statements. Both reuse the shared derivations: a bill's paid and outstanding
 * come from paymentState / effectivePayments (src/lib/payments.ts), an invoice's from invoiceBalances.
 * "Today" figures are as of the day the file is built, like the payables and receivables reports.
 */

/** A name as printed: a record saved without one (older rows) is grouped under "No name" instead of failing the file. */
const shown = (name: string | null | undefined) => (name ?? "").trim() || "No name";
const key = (name: string | null | undefined) => shown(name).toLowerCase();
const inRange = (d: string | null, from: string, to: string) => Boolean(d && d >= from && d <= to);

/** The period a statement covers: the financial year to date when no dates are given. */
function periodOf(f: Pick<ReportFilters, "from" | "to">, now: Date) {
  const today = toDateInput(now);
  return { from: f.from ?? toDateInput(financialYearIST(now).start), to: f.to ?? today, today };
}

const names = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(", ")} and ${list.length - 3} more` : list.join(", "));

/* Vendor statement */

export async function buildVendorStatementReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const now = new Date();
  const { from, to, today } = periodOf(f, now);
  // Salary payees are employees: without the salaries permission their bills and payments stay out.
  const scope = await salaryScope();
  const range = rangeOf({ from, to });
  const conditions: Record<string, unknown>[] = [
    // Bills dated in the period, bills with a payment in the period, and every bill that may still be owed.
    { $or: [{ date: range }, { "payments.date": range }, ...maybeUnpaidFilter().$or] },
    COMPANY_EXPENSES,
  ];
  if (f.vendor.length) conditions.push({ vendor: { $in: f.vendor.map(exactName) } });
  if (Object.keys(scope).length) conditions.push(scope);

  const [docs, categoryLabel] = await Promise.all([
    Expense.find({ $and: conditions } as never)
      .sort({ date: 1, _id: 1 })
      .lean(),
    getExpenseCategoryLabeler(),
  ]);

  type VendorRow = { vendor: string; bills: number; billed: number; paid: number; outstanding: number; overdue: number };
  const byVendor = new Map<string, VendorRow>();
  const vendorOf = (name: string | null | undefined) => {
    const k = key(name);
    let v = byVendor.get(k);
    if (!v) byVendor.set(k, (v = { vendor: shown(name), bills: 0, billed: 0, paid: 0, outstanding: 0, overdue: 0 }));
    return v;
  };

  const billRows: ReportRow[] = [];
  const paymentRows: ReportRow[] = [];
  for (const e of docs) {
    // A stock assignment moves no money: it is neither a bill nor a payment.
    if (!Array.isArray(e.payments) && e.paymentMethod === "stock") continue;
    const state = paymentState(e, now);
    const v = vendorOf(e.vendor);
    const date = day(e.date);
    if (state.outstanding > 0) {
      v.outstanding = round2(v.outstanding + state.outstanding);
      if (state.status === "overdue") v.overdue = round2(v.overdue + state.outstanding);
    }
    if (inRange(date, from, to)) {
      v.bills += 1;
      v.billed = round2(v.billed + e.amount);
      billRows.push({
        number: e.number,
        date,
        vendor: e.vendor,
        description: e.description ?? "",
        category: categoryLabel(e.category),
        amount: e.amount,
        paid: state.paid,
        outstanding: state.outstanding,
        due: state.outstanding > 0 && state.dueOn ? day(state.dueOn) : null,
        status: labelOf(PAYMENT_STATUSES, state.status as PaymentStatus),
      });
    }
    for (const p of effectivePayments(e)) {
      const paidOn = day(p.date);
      if (!inRange(paidOn, from, to)) continue;
      v.paid = round2(v.paid + p.amount);
      paymentRows.push({
        date: paidOn,
        vendor: e.vendor,
        number: e.number,
        description: e.description ?? "",
        mode: labelOf(PAYMENT_METHODS, p.paymentMethod as PaymentMethod),
        reference: p.reference ?? "",
        amount: p.amount,
      });
    }
  }
  paymentRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // A vendor with nothing in the period and nothing owed would only be a blank line.
  const vendorRows: ReportRow[] = [...byVendor.values()]
    .filter((v) => v.bills || v.paid || v.outstanding)
    .sort((a, b) => a.vendor.localeCompare(b.vendor, "en-IN", { sensitivity: "base" }))
    .map((v) => ({ vendor: v.vendor, bills: v.bills, billed: v.billed, paid: v.paid, outstanding: v.outstanding, overdue: v.overdue }));

  const vendorColumns = [
    col("vendor", "Vendor", "text", 30),
    col("bills", "Bills in period", "number", 10),
    col("billed", "Billed", "money", 16),
    col("paid", "Paid in period", "money", 16),
    col("outstanding", "Owed today", "money", 16),
    col("overdue", "Overdue today", "money", 16),
  ];
  const vendors: ReportSection = { title: "By vendor", columns: vendorColumns, rows: vendorRows, totals: sumTotals(vendorColumns, vendorRows, "Total", ["money", "number"]) };

  const billColumns = [
    col("number", "Expense", "text", 15),
    col("date", "Bill date", "date", 12),
    col("vendor", "Vendor", "text", 24),
    col("description", "Description", "text", 28),
    col("category", "Category", "text", 16),
    col("amount", "Amount", "money", 15),
    col("paid", "Paid so far", "money", 15),
    col("outstanding", "Owed today", "money", 15),
    col("due", "Due", "date", 12),
    col("status", "Status", "text", 11),
  ];
  const bills: ReportSection = { title: "Bills in the period", columns: billColumns, rows: billRows, totals: sumTotals(billColumns, billRows) };

  const paymentColumns = [
    col("date", "Paid on", "date", 12),
    col("vendor", "Vendor", "text", 24),
    col("number", "Expense", "text", 15),
    col("description", "Description", "text", 28),
    col("mode", "Mode", "text", 14),
    col("reference", "Reference", "text", 20),
    col("amount", "Amount", "money", 15),
  ];
  const payments: ReportSection = { title: "Payments in the period", columns: paymentColumns, rows: paymentRows, totals: sumTotals(paymentColumns, paymentRows) };

  const owed = round2(vendorRows.reduce((s, r) => s + Number(r.outstanding ?? 0), 0));
  const overdue = round2(vendorRows.reduce((s, r) => s + Number(r.overdue ?? 0), 0));
  void today;
  return {
    type: "vendor_statement",
    subtitle: [
      `Period: ${periodText({ from, to })}`,
      f.vendor.length ? `Vendors: ${names(f.vendor)}` : "All vendors",
      "Paid in period is money paid on payment dates in the period. Owed today is every unpaid bill of the vendor, as of the day this file was made.",
    ].join(" · "),
    summary: [
      { label: "Billed in period", value: round2(vendorRows.reduce((s, r) => s + Number(r.billed ?? 0), 0)), type: "money" },
      { label: "Paid in period", value: round2(paymentRows.reduce((s, r) => s + Number(r.amount ?? 0), 0)), type: "money" },
      { label: "Owed today", value: owed, type: "money" },
      { label: "Overdue today", value: overdue, type: "money" },
    ],
    ...vendors,
    title: "Vendor statement",
    sections: [vendors, bills, payments],
  };
}

/* Customer statement */

export async function buildCustomerStatementReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const now = new Date();
  const { from, to, today } = periodOf(f, now);
  const selected = f.customer ?? [];
  const clientFilter = selected.length ? { client: { $in: selected.map(exactName) } } : {};
  // Every issued invoice of these customers (cancelled ones are not owed); the period narrows the list below.
  const all = await invoiceBalances(now, clientFilter);
  const invoiceById = new Map(all.map((i) => [i.id, i]));

  const incomeFilter: Record<string, unknown> = {
    // "On credit" and "From stock" moved no money in (the income summary leaves them out too).
    paymentMethod: { $nin: ["credit", "stock"] },
    date: rangeOf({ from, to }),
  };
  if (selected.length) {
    incomeFilter.$or = [{ client: { $in: selected.map(exactName) } }, ...(all.length ? [{ invoice: { $in: all.map((i) => i.id) } }] : [])];
  }
  const receiptDocs = await Income.find(incomeFilter as never)
    .sort({ date: 1, _id: 1 })
    .lean();
  // A receipt linked to an invoice outside the customers' own invoices (same project): name that invoice too.
  const unknown = receiptDocs.flatMap((r) => (r.invoice && !invoiceById.has(String(r.invoice)) ? [r.invoice] : []));
  const extra = unknown.length ? await Invoice.find({ _id: { $in: unknown } }, { number: 1, client: 1 }).lean() : [];
  const extraById = new Map(extra.map((i) => [String(i._id), i]));

  type CustomerRow = { customer: string; invoices: number; invoiced: number; received: number; outstanding: number; overdue: number };
  const byCustomer = new Map<string, CustomerRow>();
  const customerOf = (name: string | null | undefined) => {
    const k = key(name);
    let c = byCustomer.get(k);
    if (!c) byCustomer.set(k, (c = { customer: shown(name), invoices: 0, invoiced: 0, received: 0, outstanding: 0, overdue: 0 }));
    return c;
  };

  const invoiceRows: ReportRow[] = [];
  for (const i of all) {
    const c = customerOf(i.client);
    // Owed today: invoices dated up to today, as the receivables report counts them.
    if (i.outstanding > 0 && i.date <= today) {
      c.outstanding = round2(c.outstanding + i.outstanding);
      if (i.status === "overdue") c.overdue = round2(c.overdue + i.outstanding);
    }
    if (!inRange(i.date, from, to)) continue;
    c.invoices += 1;
    c.invoiced = round2(c.invoiced + i.total);
    invoiceRows.push({
      number: i.number,
      date: i.date,
      customer: i.client,
      due: i.dueDate,
      total: i.total,
      received: i.received,
      outstanding: i.outstanding,
      status: labelOf(PAYMENT_STATUSES, i.status as PaymentStatus),
    });
  }

  const receiptRows: ReportRow[] = [];
  for (const r of receiptDocs) {
    const linked = r.invoice ? (invoiceById.get(String(r.invoice)) ?? extraById.get(String(r.invoice))) : undefined;
    const customer = linked && "client" in linked ? linked.client : r.client;
    const c = customerOf(customer);
    c.received = round2(c.received + r.amount);
    receiptRows.push({
      date: day(r.date),
      number: r.number,
      customer,
      invoice: linked ? linked.number : "",
      mode: labelOf(PAYMENT_METHODS, r.paymentMethod as PaymentMethod),
      reference: r.reference ?? "",
      category: labelOf(INCOME_CATEGORIES, (r.category ?? "other") as IncomeCategory),
      amount: r.amount,
    });
  }

  const customerRows: ReportRow[] = [...byCustomer.values()]
    .filter((c) => c.invoices || c.received || c.outstanding)
    .sort((a, b) => a.customer.localeCompare(b.customer, "en-IN", { sensitivity: "base" }))
    .map((c) => ({ customer: c.customer, invoices: c.invoices, invoiced: c.invoiced, received: c.received, outstanding: c.outstanding, overdue: c.overdue }));

  const customerColumns = [
    col("customer", "Customer", "text", 30),
    col("invoices", "Invoices in period", "number", 10),
    col("invoiced", "Invoiced", "money", 16),
    col("received", "Received in period", "money", 16),
    col("outstanding", "Owed today", "money", 16),
    col("overdue", "Overdue today", "money", 16),
  ];
  const customers: ReportSection = { title: "By customer", columns: customerColumns, rows: customerRows, totals: sumTotals(customerColumns, customerRows, "Total", ["money", "number"]) };

  const invoiceColumns = [
    col("number", "Invoice", "text", 15),
    col("date", "Date", "date", 12),
    col("customer", "Customer", "text", 26),
    col("due", "Due", "date", 12),
    col("total", "Invoice total", "money", 16),
    col("received", "Received so far", "money", 16),
    col("outstanding", "Owed today", "money", 16),
    col("status", "Status", "text", 11),
  ];
  const invoices: ReportSection = { title: "Invoices in the period", columns: invoiceColumns, rows: invoiceRows, totals: sumTotals(invoiceColumns, invoiceRows, "Total", ["money"], ["total"]) };

  const receiptColumns = [
    col("date", "Received on", "date", 12),
    col("number", "Receipt", "text", 15),
    col("customer", "Customer", "text", 26),
    col("invoice", "Invoice", "text", 15),
    col("mode", "Mode", "text", 14),
    col("reference", "Reference", "text", 20),
    col("category", "Category", "text", 16),
    col("amount", "Amount", "money", 15),
  ];
  const receipts: ReportSection = { title: "Receipts in the period", columns: receiptColumns, rows: receiptRows, totals: sumTotals(receiptColumns, receiptRows) };

  return {
    type: "customer_statement",
    subtitle: [
      `Period: ${periodText({ from, to })}`,
      selected.length ? `Customers: ${names(selected)}` : "All customers",
      "Owed today is what the customers' invoices still lack, as of the day this file was made. Received in period counts receipts not linked to an invoice too.",
    ].join(" · "),
    summary: [
      { label: "Invoiced in period", value: round2(customerRows.reduce((s, r) => s + Number(r.invoiced ?? 0), 0)), type: "money" },
      { label: "Received in period", value: round2(customerRows.reduce((s, r) => s + Number(r.received ?? 0), 0)), type: "money" },
      { label: "Owed today", value: round2(customerRows.reduce((s, r) => s + Number(r.outstanding ?? 0), 0)), type: "money" },
      { label: "Overdue today", value: round2(customerRows.reduce((s, r) => s + Number(r.overdue ?? 0), 0)), type: "money" },
    ],
    ...customers,
    title: "Customer statement",
    sections: [customers, invoices, receipts],
  };
}
