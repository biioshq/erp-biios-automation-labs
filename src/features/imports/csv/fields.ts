/**
 * The columns each CSV import understands, the header names they are recognised by, and the
 * templates. Client-safe and pure: the import panel and the server share it.
 */

export const CSV_IMPORT_KINDS = ["expenses", "income", "items"] as const;
export type CsvImportKind = (typeof CSV_IMPORT_KINDS)[number];

export type CsvField = {
  key: string;
  label: string;
  required?: boolean;
  /** Other header names this column is recognised by (compared after normalizeHeader). */
  aliases: string[];
  /** One line on what to put in the column, shown next to the column picker. */
  hint?: string;
  /** The value in the template's example row. */
  example: string;
};

/** "Amount (₹)" → "amount", "Invoice No." → "invoice no", "HSN/SAC" → "hsn sac". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[₹#]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EXPENSE_FIELDS: CsvField[] = [
  {
    key: "date",
    label: "Date",
    required: true,
    aliases: ["bill date", "expense date", "txn date", "transaction date", "paid on", "payment date", "date of expense"],
    hint: "DD/MM/YYYY, YYYY-MM-DD or 5 Nov 2026",
    example: "05/11/2026",
  },
  {
    key: "vendor",
    label: "Vendor",
    required: true,
    aliases: ["party", "party name", "supplier", "supplier name", "paid to", "payee", "vendor name", "merchant"],
    example: "Sharma Hardware",
  },
  {
    key: "amount",
    label: "Amount",
    required: true,
    aliases: ["total", "total amount", "grand total", "amount paid", "paid amount", "net amount", "debit", "invoice amount", "bill amount"],
    hint: "GST included. ₹ and commas are fine",
    example: "11800",
  },
  {
    key: "category",
    label: "Category",
    required: true,
    aliases: ["expense category", "head", "expense head", "account", "ledger"],
    hint: "A category name from the Expenses page",
    example: "Materials",
  },
  {
    key: "paymentMethod",
    label: "Payment method",
    aliases: ["payment mode", "mode", "mode of payment", "paid by", "paid via", "payment", "payment type"],
    hint: "Bank transfer, UPI, Card, Cash, Cheque, On credit…",
    example: "UPI",
  },
  { key: "description", label: "Description", aliases: ["details", "particulars", "narration", "purpose", "item", "items"], example: "Cable trays for site" },
  { key: "project", label: "Project", aliases: ["project name", "project code", "job", "site"], hint: "Project name or code", example: "" },
  { key: "stage", label: "Stage", aliases: ["project stage", "phase"], hint: "Needed when a project is given", example: "" },
  { key: "gstin", label: "GSTIN", aliases: ["gst no", "gst number", "gstin no", "vendor gstin", "supplier gstin", "gstin uin", "gst in"], example: "" },
  {
    key: "invoiceNumber",
    label: "Invoice number",
    aliases: ["invoice no", "invoice", "inv no", "invoice num", "bill no", "bill number", "voucher no"],
    example: "INV-204",
  },
  { key: "invoiceDate", label: "Invoice date", aliases: ["inv date", "date of invoice"], example: "05/11/2026" },
  {
    key: "taxableAmount",
    label: "Taxable amount",
    aliases: ["taxable value", "taxable", "base amount", "amount before tax", "assessable value"],
    example: "10000",
  },
  { key: "cgst", label: "CGST", aliases: ["cgst amount", "central tax"], example: "900" },
  { key: "sgst", label: "SGST", aliases: ["sgst amount", "state tax", "utgst"], example: "900" },
  { key: "igst", label: "IGST", aliases: ["igst amount", "integrated tax"], example: "" },
  { key: "cess", label: "Cess", aliases: ["cess amount"], example: "" },
  { key: "hsnSac", label: "HSN/SAC", aliases: ["hsn", "sac", "hsn sac", "hsn code", "sac code", "hsn sac code"], example: "7308" },
  { key: "notes", label: "Notes", aliases: ["note", "remarks", "remark", "comment", "comments"], example: "" },
];

const INCOME_FIELDS: CsvField[] = [
  {
    key: "date",
    label: "Date",
    required: true,
    aliases: ["received on", "receipt date", "payment date", "txn date", "transaction date", "date received"],
    hint: "DD/MM/YYYY, YYYY-MM-DD or 5 Nov 2026",
    example: "05/11/2026",
  },
  {
    key: "client",
    label: "Client",
    required: true,
    aliases: ["customer", "customer name", "client name", "party", "party name", "received from", "payer"],
    example: "Acme Industries",
  },
  {
    key: "amount",
    label: "Amount",
    required: true,
    aliases: ["amount received", "received amount", "total", "total amount", "credit", "net amount"],
    hint: "₹ and commas are fine",
    example: "50000",
  },
  {
    key: "category",
    label: "Category",
    aliases: ["income category", "type", "income type", "head"],
    hint: "Project payment, Advance, Retainer, Product sale, Grant or Other",
    example: "Project payment",
  },
  {
    key: "paymentMethod",
    label: "Payment method",
    aliases: ["payment mode", "mode", "mode of payment", "received via", "payment", "payment type"],
    hint: "Bank transfer, UPI, Card, Cash, Cheque…",
    example: "Bank transfer",
  },
  { key: "project", label: "Project", aliases: ["project name", "project code", "job"], hint: "Project name or code", example: "" },
  {
    key: "reference",
    label: "Reference",
    aliases: ["ref", "ref no", "reference no", "reference number", "utr", "utr no", "transaction id", "txn id", "cheque no", "cheque number"],
    example: "UTR 4029381",
  },
  { key: "notes", label: "Notes", aliases: ["note", "remarks", "remark", "comment", "comments", "description", "narration"], example: "" },
];

const ITEM_FIELDS: CsvField[] = [
  { key: "name", label: "Name", required: true, aliases: ["item", "item name", "product", "product name", "material", "material name"], example: "MCB 32A double pole" },
  { key: "sku", label: "SKU", aliases: ["code", "item code", "product code", "part number", "part no", "sku code"], hint: "Left empty, one is made from the name", example: "" },
  { key: "category", label: "Category", aliases: ["item category", "group", "item group"], hint: "An inventory category name", example: "Electrical" },
  { key: "unit", label: "Unit", aliases: ["uom", "units", "unit of measure"], hint: "pcs, set, box, kg, g, m, ft, l, roll, sheet, pair", example: "pcs" },
  { key: "minStock", label: "Min stock", aliases: ["minimum stock", "min qty", "minimum quantity", "reorder level", "reorder point", "reorder qty"], example: "5" },
  { key: "vendor", label: "Vendor", aliases: ["supplier", "supplier name", "party", "party name", "vendor name"], example: "Sharma Hardware" },
  { key: "location", label: "Location", aliases: ["bin", "rack", "store", "shelf", "storage", "warehouse"], example: "Rack A2" },
  { key: "description", label: "Description", aliases: ["details", "specification", "specs", "notes"], example: "" },
  { key: "quantity", label: "Quantity", aliases: ["qty", "opening stock", "opening quantity", "opening qty", "stock", "in stock", "quantity bought"], example: "10" },
  { key: "unitPrice", label: "Unit price", aliases: ["price", "rate", "cost", "unit cost", "price per unit", "cost per unit", "purchase price"], hint: "Per unit, ₹", example: "450" },
  { key: "purchaseDate", label: "Purchase date", aliases: ["date", "bought on", "bill date", "purchased on", "date of purchase"], hint: "Empty means today", example: "05/11/2026" },
  {
    key: "paymentMethod",
    label: "Payment method",
    aliases: ["payment mode", "mode", "mode of payment", "paid by", "paid via", "payment"],
    hint: "How the stock was paid for",
    example: "Bank transfer",
  },
];

export const CSV_FIELDS: Record<CsvImportKind, CsvField[]> = {
  expenses: EXPENSE_FIELDS,
  income: INCOME_FIELDS,
  items: ITEM_FIELDS,
};

export const KIND_LABELS: Record<CsvImportKind, { one: string; many: string; title: string }> = {
  expenses: { one: "expense", many: "expenses", title: "Expenses" },
  income: { one: "income record", many: "income records", title: "Income" },
  items: { one: "item", many: "items", title: "Inventory items" },
};

/** Most rows one file may hold. */
export const MAX_CSV_ROWS = 2000;
/** Rows checked per dry-run request. */
export const PREVIEW_CHUNK = 500;
/** Rows saved per import request. Stock rows do more work each, so they go in smaller batches. */
export const IMPORT_BATCH: Record<CsvImportKind, number> = { expenses: 50, income: 50, items: 10 };

/**
 * The field each column maps to, from its header: exact key, label or alias first. A field is
 * given to one column only (the first that matches), so duplicate headers do not overwrite.
 */
export function autoMapColumns(kind: CsvImportKind, headers: string[]): (string | null)[] {
  const fields = CSV_FIELDS[kind];
  const names = new Map<string, string>();
  for (const f of fields) {
    for (const name of [f.key, f.label, ...f.aliases]) {
      const n = normalizeHeader(name);
      if (n && !names.has(n)) names.set(n, f.key);
    }
  }
  const used = new Set<string>();
  return headers.map((h) => {
    const n = normalizeHeader(h);
    let key = names.get(n) ?? names.get(n.replace(/\s/g, ""));
    // "Amount Rs", "GST No." and the like: drop a trailing currency word and try again.
    if (!key) key = names.get(n.replace(/\s+(rs|inr|rupees)$/, ""));
    if (!key || used.has(key)) return null;
    used.add(key);
    return key;
  });
}

/** The template file: the header row and one example row. */
export function templateRows(kind: CsvImportKind): string[][] {
  const fields = CSV_FIELDS[kind];
  return [fields.map((f) => f.label), fields.map((f) => f.example)];
}

/** A field's column name for messages ("amount" → "Amount"); keys that are not columns are shown as they are. */
export function fieldLabel(kind: CsvImportKind, key: string): string {
  const named: Record<string, string> = { projectId: "Project", categoryId: "Category", gst: "GST", invoice: "Invoice", row: "Row" };
  return CSV_FIELDS[kind].find((f) => f.key === key)?.label ?? named[key] ?? key;
}
