import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Income, Invoice } from "@/server/models";
import { invoiceBalances } from "@/server/finance/summaries";
import { getCompanyIdentity, type CompanyIdentity } from "@/features/settings/company/server";
import { INCOME_CATEGORIES, PAYMENT_METHODS, labelOf, type IncomeCategory, type PaymentMethod } from "@/lib/constants";
import { endOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { pdfDate, pdfMoney } from "@/features/reports/server/pdf-kit";
import type { DocumentSpec, Tone } from "./render-document";

/**
 * Reads an invoice or an income record and shapes it into a DocumentSpec. Nothing is recomputed:
 * the line amounts, taxable value, CGST, SGST, IGST and total are printed as stored, and the
 * payment status comes from invoiceBalances (the same figures as the invoices page).
 */

export type BuiltDocument = { spec: DocumentSpec; company: CompanyIdentity; fileName: string };

/** A file name that is safe in a header: letters, digits, dot, dash and underscore only. */
export function safeFileName(prefix: string, number: string, extension = "pdf"): string {
  const cleaned = number
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${prefix}-${cleaned || "document"}.${extension}`;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "good" },
  partial: { label: "Partly paid", tone: "warn" },
  unpaid: { label: "Unpaid", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
};

const formatDay = (ymd: string) => pdfDate(ymd);
const methodLabel = (m: string) => labelOf(PAYMENT_METHODS, m as PaymentMethod);

/** The tax rows as stored: only the heads that carry an amount. */
function taxRows(i: { taxableAmount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null }) {
  const rows: { label: string; amount: number }[] = [];
  if ((i.cgst ?? 0) > 0) rows.push({ label: "CGST", amount: i.cgst! });
  if ((i.sgst ?? 0) > 0) rows.push({ label: "SGST", amount: i.sgst! });
  if ((i.igst ?? 0) > 0) rows.push({ label: "IGST", amount: i.igst! });
  return rows;
}

export async function buildInvoiceDocument(id: string, now: Date = new Date()): Promise<BuiltDocument | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const invoice = await Invoice.findById(id).populate("project", "name").lean();
  if (!invoice) return null;
  const company = await getCompanyIdentity();
  const cancelled = invoice.status === "cancelled";
  const tax = taxRows(invoice);
  const hasTax = tax.length > 0;
  const title = company.gstin && hasTax ? "Tax invoice" : "Invoice";

  // Receipts counted the way invoiceBalances counts them: linked, dated up to the end of today.
  const [balance] = cancelled ? [] : await invoiceBalances(now, { _id: invoice._id });
  const receipts = cancelled
    ? []
    : await Income.find({ invoice: invoice._id, date: { $lte: endOfDayIST(now) } }, { number: 1, date: 1, amount: 1, paymentMethod: 1, reference: 1 })
        .sort({ date: 1, _id: 1 })
        .lean();

  const project = invoice.project as unknown as { name?: string } | null;
  const status = cancelled ? { label: "Cancelled", tone: "neutral" as Tone } : (STATUS[balance?.status ?? "unpaid"] ?? STATUS.unpaid!);
  const modes = [...new Set(receipts.map((r) => methodLabel(r.paymentMethod)))];
  const statusLines: [string, string][] = cancelled
    ? []
    : [
        ["Received so far", pdfMoney(balance?.received ?? 0)],
        ["Balance due", pdfMoney(balance?.outstanding ?? invoice.total)],
        ...(balance && balance.credit && balance.credit > 0 ? ([["Received above total", pdfMoney(balance.credit)]] as [string, string][]) : []),
        ["Payment mode", modes.join(", ")],
      ];

  const spec: DocumentSpec = {
    title,
    number: invoice.number,
    meta: [
      ["Invoice date", formatDay(toDateInput(invoice.date))],
      ["Due date", invoice.dueDate ? formatDay(toDateInput(invoice.dueDate)) : ""],
      ["Project", project?.name ?? ""],
      ["Supply", hasTax ? (invoice.interState ? "Another state (IGST)" : "Within the state (CGST and SGST)") : ""],
    ],
    party: { heading: "Bill to", name: invoice.client, lines: [invoice.clientGstin ? `GSTIN: ${invoice.clientGstin}` : ""] },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      detail: l.hsnSac ? `HSN/SAC ${l.hsnSac}` : undefined,
      quantity: l.quantity ?? 1,
      rate: l.rate ?? 0,
      gstRate: l.gstRate ?? 0,
      amount: l.amount ?? 0,
    })),
    totals: [
      ...(hasTax ? [{ label: "Taxable value", amount: invoice.taxableAmount ?? 0 }, ...tax] : []),
      { label: title === "Tax invoice" ? "Invoice total" : "Total", amount: invoice.total, strong: true },
    ],
    wordsAmount: invoice.total,
    status,
    statusLines,
    receipts: receipts.map((r) => ({
      date: toDateInput(r.date),
      number: r.number,
      mode: methodLabel(r.paymentMethod),
      reference: r.reference ?? "",
      amount: r.amount,
    })),
    showPaymentDetails: !cancelled && (balance?.outstanding ?? invoice.total) > 0,
    showTerms: !cancelled,
    notes: invoice.notes ?? undefined,
    watermark: cancelled ? "Cancelled" : undefined,
  };
  return { spec, company, fileName: safeFileName("biios-invoice", invoice.number) };
}

export async function buildReceiptDocument(id: string, opts: { includeInvoice: boolean }): Promise<BuiltDocument | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const income = await Income.findById(id).populate("project", "name").lean();
  if (!income) return null;
  const company = await getCompanyIdentity();
  // "On credit" and "From stock" records moved no money in: they are not receipts of money.
  const notReceived = income.paymentMethod === "credit" || income.paymentMethod === "stock";
  const project = income.project as unknown as { name?: string } | null;
  const category = labelOf(INCOME_CATEGORIES, (income.category ?? "other") as IncomeCategory);

  const detail = [project?.name ? `Project: ${project.name}` : "", income.notes ?? ""].filter(Boolean).join("\n");
  const mode = methodLabel(income.paymentMethod);

  let factBlock: DocumentSpec["factBlock"];
  let party = { heading: "Received from", name: income.client, lines: [] as string[] };
  if (income.invoice) {
    const invoice = await Invoice.findById(income.invoice).lean();
    if (invoice) {
      if (!opts.includeInvoice) {
        factBlock = { title: "Against an invoice", rows: [["Invoice", invoice.number]] };
      } else {
        // Balance after this receipt: the invoice total less every receipt linked to it up to and
        // including this one, in date then record order (the order the books settle them in).
        const linked = await Income.find({ invoice: invoice._id }, { amount: 1, date: 1 }).sort({ date: 1, _id: 1 }).lean();
        let settled = 0;
        for (const r of linked) {
          settled += r.amount;
          if (String(r._id) === String(income._id)) break;
        }
        settled = round2(settled);
        const balance = round2(Math.max(0, invoice.total - settled));
        const tax = taxRows(invoice);
        factBlock = {
          title: `Against invoice ${invoice.number}${tax.length ? " (tax figures are the invoice's)" : ""}`,
          rows: [
            ["Invoice date", formatDay(toDateInput(invoice.date))],
            ["Invoice total", pdfMoney(invoice.total)],
            ["Received up to this receipt", pdfMoney(settled)],
            ["Balance after this receipt", pdfMoney(balance)],
            ...(invoice.status === "cancelled" ? ([["Invoice status", "Cancelled"]] as [string, string][]) : []),
            ...(tax.length
              ? ([["Taxable value", pdfMoney(invoice.taxableAmount ?? 0)], ...tax.map((t) => [t.label, pdfMoney(t.amount)])] as [string, string][])
              : []),
          ],
        };
        if (invoice.clientGstin) party = { ...party, lines: [`GSTIN: ${invoice.clientGstin}`] };
      }
    }
  }

  const spec: DocumentSpec = {
    title: "Payment receipt",
    number: `Receipt ${income.number}`,
    meta: [
      ["Date", formatDay(toDateInput(income.date))],
      ["Receipt for", category],
    ],
    party,
    items: [{ description: category, detail: detail || undefined, amount: income.amount }],
    totals: [{ label: notReceived ? "Amount recorded" : "Amount received", amount: income.amount, strong: true }],
    wordsAmount: income.amount,
    wordsLabel: notReceived ? "Amount in words" : "Amount received in words",
    status: notReceived ? { label: "Not received", tone: "neutral" } : { label: "Received", tone: "good" },
    statusLines: [
      ["Payment mode", mode],
      ["Reference", income.reference ?? ""],
    ],
    factBlock,
    showPaymentDetails: false,
    showTerms: false,
  };
  return { spec, company, fileName: safeFileName("biios-receipt", income.number) };
}
