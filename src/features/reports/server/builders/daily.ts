import "server-only";

import { getDailyOverview } from "@/features/finance/daily/server";
import { financialYearIST, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import { col, describeFilters, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow } from "../../types";

/** Up to this many transactions are listed in a file (the page shows the latest 200). */
const TRANSACTION_ROWS = 5000;

const KIND_LABELS = {
  expense: "Expense billed",
  payment: "Payment made",
  receipt: "Income received",
  transfer: "Transfer between own accounts",
} as const;

/**
 * The daily record: one row per day, then vendor-wise and customer-wise totals and every transaction of
 * the period. It builds from the same service as /finance/daily, so a file matches the page. Dates
 * follow the other period reports: no start means the financial year to date, no end means today.
 * Cash flow comes from the books only for people with Company financial position and no filters.
 */
export async function buildDailyReport(f: ReportFilters): Promise<ReportData> {
  const today = toDateInput(new Date());
  const from = f.from ?? toDateInput(financialYearIST().start);
  const to = f.to ?? today;
  const data = await getDailyOverview({
    from,
    to,
    filters: { project: f.project, vendor: f.vendor, category: f.category },
    transactionLimit: TRANSACTION_ROWS,
    // The file is the full record: every vendor and customer, so its section totals match the summary.
    partyLimit: Number.POSITIVE_INFINITY,
  });

  const ledger = data.net?.basis === "ledger";
  const dayColumns = [
    col("day", "Date", "date", 13),
    col("weekday", "Day", "text", 8),
    col("income", "Income received", "money", 16),
    col("expenses", "Expenses incurred", "money", 17),
    col("payments", "Payments made", "money", 16),
    col("outstanding", "Owed at end of day", "money", 17),
    col("overdue", "Of which overdue", "money", 16),
    ...(ledger ? [col("cashIn", "Cash in", "money", 14), col("cashOut", "Cash out", "money", 14), col("netCash", "Net cash flow", "money", 15)] : []),
    ...(data.net?.basis === "records" ? [col("recordsNet", "Received less paid", "money", 16)] : []),
  ];
  const dayRows: ReportRow[] = data.days.map((d) => ({
    day: d.day,
    weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d.day}T00:00:00Z`)),
    income: d.income,
    expenses: d.expenses,
    payments: d.payments,
    outstanding: d.outstanding,
    overdue: d.overdue,
    cashIn: d.cashIn,
    cashOut: d.cashOut,
    netCash: d.netCash,
    recordsNet: round2(d.income - d.payments),
  }));
  // Owed is a balance at a day's end, not a flow: it is not added up over days.
  const dayTotals = sumTotals(dayColumns, dayRows, "Total", ["money"], ["income", "expenses", "payments", "cashIn", "cashOut", "netCash", "recordsNet"]);

  const vendorColumns = [
    col("vendor", "Vendor", "text", 30),
    col("incurred", "Expenses incurred", "money", 17),
    col("paid", "Paid in period", "money", 16),
    col("owed", "Owed at end", "money", 15),
  ];
  const vendorRows: ReportRow[] = data.vendors.map((v) => ({ vendor: v.vendor, incurred: v.incurred, paid: v.paid, owed: v.owed }));
  const customerColumns = [col("client", "Customer", "text", 30), col("count", "Receipts", "number", 10), col("received", "Income received", "money", 17)];
  const customerRows: ReportRow[] = data.customers.map((c) => ({ client: c.client, count: c.count, received: c.received }));
  const txColumns = [
    col("day", "Date", "date", 13),
    col("kind", "Type", "text", 26),
    col("title", "Number", "text", 16),
    col("party", "Vendor or customer", "text", 30),
    col("detail", "Details", "text", 34),
    col("amount", "Amount", "money", 15),
  ];
  const txRows: ReportRow[] = data.transactions.map((t) => ({ day: t.day, kind: KIND_LABELS[t.kind], title: t.title, party: t.party, detail: t.detail, amount: t.amount }));

  const period = data.single ? formatDate(fromDateInput(data.from)) : `${formatDate(fromDateInput(data.from))} to ${formatDate(fromDateInput(data.to))}`;
  const notes = [
    "Income by date received (not On credit); expenses by expense date; payments by payment date; owed at the end of each day",
    ledger ? "Cash flow from the books, transfers between own accounts left out" : data.net ? "Received less paid is from the records, not the bank" : "",
    data.filters.vendor.length || data.filters.category.length ? "Vendor and category narrow expenses and payments only" : "",
    data.clamped ? "Shortened to the last 366 days" : "",
    data.salariesHidden ? "Salaries are hidden for your role" : "",
  ].filter(Boolean);
  const filterText = await describeFilters({ ...f, from: data.from, to: data.to }, { categories: "expense", period: false });

  return {
    type: "daily",
    title: "Daily overview",
    subtitle: [`Period: ${period}`, filterText, ...notes].filter(Boolean).join(" · "),
    columns: dayColumns,
    rows: dayRows,
    totals: dayTotals,
    summary: [
      { label: "Income received", value: data.totals.income, type: "money" },
      { label: "Expenses incurred", value: data.totals.expenses, type: "money" },
      { label: "Payments made", value: data.totals.payments, type: "money" },
      { label: "Owed to vendors at end", value: data.totals.outstanding, type: "money" },
      ...(data.net ? [{ label: data.net.basis === "ledger" ? "Net cash flow" : "Received less paid", value: data.net.value, type: "money" as const }] : []),
    ],
    sections: [
      { title: "Daily overview", columns: dayColumns, rows: dayRows, totals: dayTotals },
      {
        title: data.vendorCount > data.vendors.length ? `Vendor-wise (${data.vendors.length} of ${data.vendorCount})` : "Vendor-wise",
        columns: vendorColumns,
        rows: vendorRows,
        totals: sumTotals(vendorColumns, vendorRows, "Total", ["money"], ["incurred", "paid", "owed"]),
      },
      {
        title: data.customerCount > data.customers.length ? `Customer-wise receipts (${data.customers.length} of ${data.customerCount})` : "Customer-wise receipts",
        columns: customerColumns,
        rows: customerRows,
        totals: sumTotals(customerColumns, customerRows, "Total", ["money", "number"]),
      },
      {
        title: data.transactionTotal > data.transactions.length ? `Transactions (latest ${data.transactions.length} of ${data.transactionTotal})` : "Transactions",
        columns: txColumns,
        rows: txRows,
        totals: null,
      },
    ],
  };
}
