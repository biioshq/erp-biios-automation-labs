import "server-only";

import { connectDB } from "@/server/db";
import { Expense, InventoryMovement } from "@/server/models";
import { expenseFilter } from "@/features/finance/expenses/queries";
import { gstGrandTotal } from "@/lib/gst";
import { round2 } from "@/lib/format";
import { col, day, describeFilters, rangeOf, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

const columns = [
  col("source", "Source", "text", 15),
  col("ref", "Reference", "text", 16),
  col("date", "Date", "date", 13),
  col("supplier", "Supplier", "text", 26),
  col("gstin", "GSTIN", "text", 18),
  col("invoice", "Invoice no", "text", 16),
  col("hsn", "HSN/SAC", "text", 11),
  col("taxable", "Taxable", "money", 14),
  col("cgst", "CGST", "money", 12),
  col("sgst", "SGST", "money", 12),
  col("igst", "IGST", "money", 12),
  col("cess", "CESS", "money", 10),
  col("total", "Invoice total", "money", 15),
];

const TAX_POSITIVE = (prefix: string) => ({
  $gt: [
    {
      $add: ["cgst", "sgst", "igst", "cess"].map((h) => ({ $ifNull: [`$${prefix}.${h}`, 0] })),
    },
    0,
  ],
});

/**
 * Input tax credit register: GST on expenses plus GST on stock purchase invoices.
 * Assignment expenses are left out on purpose: they carry no GST because it was
 * claimed on the purchase, so counting them would claim it twice.
 */
export async function buildGstReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();

  const expenseBase = expenseFilter({
    q: f.q,
    from: f.from,
    to: f.to,
    filters: {
      ...(f.project.length ? { project: f.project } : {}),
      ...(f.vendor.length ? { vendor: f.vendor } : {}),
      ...(f.category.length ? { category: f.category } : {}),
    },
  });
  const expenseQuery = {
    $and: [expenseBase, { source: { $ne: "inventory_assignment" }, gst: { $exists: true }, $expr: TAX_POSITIVE("gst") }],
  };

  // Stock purchases have no project or expense category of their own: they count as "inventory" spend.
  const includePurchases = f.project.length === 0 && (f.category.length === 0 || f.category.includes("inventory"));
  const purchaseQuery: Record<string, unknown> = { type: "purchase", invoice: { $exists: true }, $expr: TAX_POSITIVE("invoice") };
  const range = rangeOf(f);
  if (range) purchaseQuery.date = range;
  if (f.vendor.length) purchaseQuery.vendor = { $in: f.vendor };

  const [expenses, purchases] = await Promise.all([
    Expense.find(expenseQuery as never).sort({ date: 1, _id: 1 }).lean(),
    includePurchases
      ? InventoryMovement.find(purchaseQuery as never).sort({ date: 1, _id: 1 }).populate("item", "name sku").lean()
      : Promise.resolve([]),
  ]);

  type Entry = ReportRow & { _sort: string };
  const entries: Entry[] = [];
  for (const e of expenses) {
    const g = e.gst!;
    entries.push({
      source: "Expense",
      ref: e.number,
      date: day(e.date),
      supplier: e.vendor,
      gstin: g.gstin ?? "",
      invoice: g.invoiceNumber ?? "",
      hsn: g.hsnSac ?? "",
      taxable: g.taxableAmount ?? 0,
      cgst: g.cgst ?? 0,
      sgst: g.sgst ?? 0,
      igst: g.igst ?? 0,
      cess: g.cess ?? 0,
      total: g.grandTotal || gstGrandTotal(g),
      _sort: `${day(e.date)}-1-${e._id}`,
    });
  }
  for (const m of purchases) {
    const inv = m.invoice!;
    const item = m.item as unknown as { name: string; sku: string } | null;
    entries.push({
      source: "Stock purchase",
      ref: item?.sku ?? "",
      date: day(m.date),
      supplier: m.vendor ?? "",
      gstin: inv.gstin ?? "",
      invoice: inv.number ?? "",
      hsn: inv.hsnSac ?? "",
      taxable: inv.taxableAmount ?? 0,
      cgst: inv.cgst ?? 0,
      sgst: inv.sgst ?? 0,
      igst: inv.igst ?? 0,
      cess: inv.cess ?? 0,
      total: inv.total || gstGrandTotal(inv),
      _sort: `${day(m.date)}-2-${m._id}`,
    });
  }
  entries.sort((a, b) => a._sort.localeCompare(b._sort));
  const rows: ReportRow[] = entries.map(({ _sort, ...r }) => {
    void _sort;
    return r;
  });
  const totals = sumTotals(columns, rows);
  const head = (k: string) => Number(totals[k] ?? 0);
  const itc = round2(head("cgst") + head("sgst") + head("igst") + head("cess"));

  // Totals by supplier GSTIN, for the return reconciliation.
  const byGstin = new Map<string, { supplier: string; invoices: number; taxable: number; cgst: number; sgst: number; igst: number; cess: number }>();
  for (const r of rows) {
    const key = String(r.gstin || "Unregistered");
    const cur = byGstin.get(key) ?? { supplier: String(r.supplier ?? ""), invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
    cur.invoices += 1;
    for (const k of ["taxable", "cgst", "sgst", "igst", "cess"] as const) cur[k] = round2(cur[k] + Number(r[k] ?? 0));
    byGstin.set(key, cur);
  }
  const gstinRows: ReportRow[] = [...byGstin.entries()]
    .map(([gstin, v]) => ({ gstin, ...v, tax: round2(v.cgst + v.sgst + v.igst + v.cess) }))
    .sort((a, b) => b.tax - a.tax);
  const gstinSection: ReportSection = {
    title: "Input credit by GSTIN",
    columns: [
      col("gstin", "GSTIN", "text", 20),
      col("supplier", "Supplier", "text", 28),
      col("invoices", "Invoices", "number", 10),
      col("taxable", "Taxable", "money", 15),
      col("cgst", "CGST", "money", 13),
      col("sgst", "SGST", "money", 13),
      col("igst", "IGST", "money", 13),
      col("cess", "CESS", "money", 11),
      col("tax", "Total tax", "money", 15),
    ],
    rows: gstinRows,
    totals: null,
  };
  gstinSection.totals = sumTotals(gstinSection.columns, gstinRows, "Total", ["money", "number"]);

  const subtitle = await describeFilters(f, { categories: "expense" });
  const registerSection: ReportSection = { title: "Input tax credit register", columns, rows, totals };
  return {
    type: "gst",
    ...registerSection,
    title: "GST input credit report",
    subtitle: [subtitle, !includePurchases && f.project.length ? "Stock purchases are not tied to a project and are left out" : ""].filter(Boolean).join(" · "),
    summary: [
      { label: "Invoices", value: rows.length, type: "number" },
      { label: "Taxable value", value: head("taxable"), type: "money" },
      { label: "CGST", value: head("cgst"), type: "money" },
      { label: "SGST", value: head("sgst"), type: "money" },
      { label: "IGST", value: head("igst"), type: "money" },
      { label: "CESS", value: head("cess"), type: "money" },
      { label: "Input tax credit", value: itc, type: "money" },
    ],
    sections: [registerSection, gstinSection],
  };
}
