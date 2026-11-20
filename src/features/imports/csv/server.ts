import "server-only";

import { Expense, Income, InventoryCategory, InventoryItem, InventoryMovement, Project } from "@/server/models";
import { roundQty } from "@/server/services/inventory-ledger";
import { loadExpenseCategories } from "@/server/expense-categories";
import { createExpense } from "@/features/finance/expenses/actions";
import { createIncome } from "@/features/finance/income/actions";
import { createItem } from "@/features/inventory/items/actions";
import { purchaseStockAction } from "@/features/inventory/ledger/actions";
import { createCategory } from "@/features/inventory/categories/actions";
import { CATEGORY_COLORS } from "@/features/inventory/categories/schemas";
import { expenseFormSchema, type ExpenseFormInput } from "@/features/finance/expenses/schemas";
import { incomeFormSchema, type IncomeFormInput } from "@/features/finance/income/schemas";
import { itemFormSchema, type ItemFormInput } from "@/features/inventory/items/schemas";
import { purchaseFormSchema, type PurchaseFormInput } from "@/features/inventory/ledger/schemas";
import { matchItemName, normalizeItemName, normalizeSku } from "@/features/inventory/items/matching";
import {
  MAX_ATTRIBUTES,
  SUBCATEGORY_MAX,
  attributeKey,
  cleanAttributes,
  nameMatchConfirmed,
  partDifference,
  type ItemAttribute,
} from "@/features/inventory/items/attributes";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  INVENTORY_UNITS,
  PAYMENT_METHODS,
  PROJECT_STAGES,
  labelOf,
  type PaymentMethod,
} from "@/lib/constants";
import type { PurchasePaymentMethod } from "@/features/inventory/ledger/schemas";
import type { ExpenseCategoryOption } from "@/lib/expense-categories";
import type { ActionResult } from "@/lib/action-result";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatCurrency, formatDate, formatNumber, round2 } from "@/lib/format";
import { fieldLabel, type CsvImportKind } from "./fields";
import type { CsvOptions, CsvRowInput, ImportResult, ImportRowResult, PreviewRow, RowIssue } from "./schemas";
import { PAYMENT_ALIASES, UNIT_ALIASES, choiceKey, looseKey, matchChoice, parseDateCell, parseMoneyCell, parseNumberCell } from "./values";
import { isInterState } from "@/lib/gst";

/**
 * The CSV import's rules. Every row is read by the same builder in the dry run and in the import,
 * checked with the same Zod schemas as the forms, and saved through the same server actions as the
 * screens (createExpense, createIncome, createItem, purchaseStockAction), so categories, GST
 * rules, project checks and stock expenses come out exactly as if each row had been typed in.
 */

type Values = Record<string, string>;

/** Collects issues, keeping the first message per field (a cell's own error beats the schema's). */
class Issues {
  list: RowIssue[] = [];
  add(field: string, message: string) {
    if (!this.list.some((i) => i.field === field)) this.list.push({ field, message });
  }
  get any() {
    return this.list.length > 0;
  }
}

/** A Zod issue path to the CSV field it is about. */
function fieldOfPath(path: readonly PropertyKey[], renames: Record<string, string> = {}): string {
  const [a, b] = path.map(String);
  if ((a === "gst" || a === "invoice") && b) return b;
  return renames[a] ?? a ?? "row";
}

function addSchemaIssues(issues: Issues, error: { issues: { path: readonly PropertyKey[]; message: string }[] }, renames: Record<string, string> = {}) {
  for (const i of error.issues) issues.add(fieldOfPath(i.path, renames), i.message);
}

const text = (v: Values, key: string) => (v[key] ?? "").trim();
const optional = (s: string) => (s ? s : undefined);
const showDate = (ymd: string) => formatDate(fromDateInput(ymd));
const showMoney = (n: number) => formatCurrency(n, { exact: !Number.isInteger(round2(n)) });

function readDate(v: Values, key: string, issues: Issues, required: string | null): string | undefined {
  const r = parseDateCell(v[key]);
  if (r.error) issues.add(key, r.error);
  else if (!r.value && required) issues.add(key, required);
  return r.value;
}

function readMoney(v: Values, key: string, issues: Issues, required: string | null): number | undefined {
  const r = parseMoneyCell(v[key]);
  if (r.error) issues.add(key, r.error);
  else if (r.value === undefined && required) issues.add(key, required);
  return r.value;
}

/** A date this far ahead is probably a typo in the year, so the preview points it out. */
const AHEAD_DAYS = 30;
const aheadLimit = () => toDateInput(new Date(Date.now() + AHEAD_DAYS * 86_400_000));

function noteIfAhead(date: string | undefined, key: string, notes: Record<string, string>) {
  if (date && date > aheadLimit()) notes[key] = "More than a month ahead. Check the year.";
}

function readNumber(v: Values, key: string, issues: Issues): number | undefined {
  const r = parseNumberCell(v[key]);
  if (r.error) issues.add(key, r.error);
  return r.value;
}

const OFFERED_PAYMENT_METHODS = PAYMENT_METHODS.filter((p) => p.value !== "stock");

/** The payment method in the cell, or the import's default for an empty cell (noted, so the preview shows it). */
function readPaymentMethod(
  v: Values,
  issues: Issues,
  notes: Record<string, string>,
  shown: Record<string, string>,
  fallback: PurchasePaymentMethod,
): PurchasePaymentMethod {
  const raw = text(v, "paymentMethod");
  if (!raw) {
    notes.paymentMethod = "Default";
    shown.paymentMethod = labelOf(PAYMENT_METHODS, fallback);
    return fallback;
  }
  const found = matchChoice(raw, PAYMENT_METHODS, PAYMENT_ALIASES as Record<string, PaymentMethod>);
  if (found === "stock") {
    issues.add("paymentMethod", "From stock is only for stock taken from inventory. Use how it was paid.");
    return fallback;
  }
  if (!found) {
    issues.add("paymentMethod", `Unknown payment method. Use ${OFFERED_PAYMENT_METHODS.map((p) => p.label).join(", ")}`);
    return fallback;
  }
  shown.paymentMethod = labelOf(PAYMENT_METHODS, found);
  return found;
}

/* ---------- Lookups ---------- */

type ProjectRef = { id: string; name: string; code: string; status: string };

type FinanceLookups = {
  expenseCategories: ExpenseCategoryOption[];
  projects: Map<string, ProjectRef[]>;
};

async function loadFinanceLookups(withCategories: boolean): Promise<FinanceLookups> {
  const [expenseCategories, projects] = await Promise.all([
    withCategories ? loadExpenseCategories() : Promise.resolve([]),
    Project.find({}, { name: 1, code: 1, status: 1 }).lean(),
  ]);
  const byKey = new Map<string, ProjectRef[]>();
  for (const p of projects) {
    const ref = { id: String(p._id), name: p.name, code: p.code, status: p.status ?? "planning" };
    for (const key of new Set([looseKey(p.name), looseKey(p.code)])) {
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push(ref);
      byKey.set(key, list);
    }
  }
  return { expenseCategories, projects: byKey };
}

function readProject(v: Values, ctx: FinanceLookups, issues: Issues, shown: Record<string, string>, refuseCancelled: boolean): ProjectRef | undefined {
  const raw = text(v, "project");
  if (!raw) return undefined;
  const matches = ctx.projects.get(looseKey(raw)) ?? [];
  if (matches.length === 0) {
    issues.add("project", `No project named or coded ${raw}`);
    return undefined;
  }
  if (matches.length > 1) {
    issues.add("project", `${matches.length} projects are named ${raw}. Use the project code instead.`);
    return undefined;
  }
  const p = matches[0];
  if (refuseCancelled && p.status === "cancelled") {
    issues.add("project", `${p.name} is cancelled, so it takes no new expenses`);
    return undefined;
  }
  shown.project = `${p.name} (${p.code})`;
  return p;
}

const BUILT_IN_LABELS = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [choiceKey(c.label), c.value]));

/** By value, current name, or a built-in's usual name (so "Travel" still finds a renamed Travel). */
function findExpenseCategory(raw: string, categories: ExpenseCategoryOption[]): ExpenseCategoryOption | undefined {
  const k = choiceKey(raw);
  return (
    categories.find((c) => choiceKey(c.label) === k) ??
    categories.find((c) => choiceKey(c.value) === k || c.value === raw.trim()) ??
    categories.find((c) => c.value === BUILT_IN_LABELS.get(k))
  );
}

/* ---------- Expenses ---------- */

type Built<I> = {
  input: I;
  issues: Issues;
  notes: Record<string, string>;
  shown: Record<string, string>;
  amount: number;
  dupKeys: string[];
};

const dayKey = (prefix: string, date: string, party: string, amount: number) => `${prefix}|${date}|${looseKey(party)}|${round2(amount).toFixed(2)}`;
const refKey = (prefix: string, party: string, ref: string) => `${prefix}|${looseKey(party)}|${looseKey(ref)}`;

function buildExpense(v: Values, ctx: FinanceLookups, options: CsvOptions): Built<ExpenseFormInput> {
  const issues = new Issues();
  const notes: Record<string, string> = {};
  const shown: Record<string, string> = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, s.trim()]));

  const date = readDate(v, "date", issues, "Date is required");
  if (date) shown.date = showDate(date);
  noteIfAhead(date, "date", notes);
  const vendor = text(v, "vendor");
  if (!vendor) issues.add("vendor", "Vendor is required");
  const amount = readMoney(v, "amount", issues, "Amount is required");
  if (amount !== undefined) shown.amount = showMoney(amount);

  let category = "";
  const categoryRaw = text(v, "category");
  if (!categoryRaw) issues.add("category", "Category is required");
  else {
    const c = findExpenseCategory(categoryRaw, ctx.expenseCategories);
    if (!c) issues.add("category", `No category named ${categoryRaw}. Add it on the Expenses page first, or use one that exists.`);
    else if (c.value === "inventory") {
      issues.add("category", "Stock for inventory is added under Inventory (Purchase stock or Import items), which records its expense.");
    } else if (c.hidden) issues.add("category", `${c.label} is hidden, so it takes no new records`);
    else {
      category = c.value;
      shown.category = c.label;
    }
  }

  const paymentMethod = readPaymentMethod(v, issues, notes, shown, options.defaultPaymentMethod);
  const project = readProject(v, ctx, issues, shown, true);
  let stage: ExpenseFormInput["stage"];
  const stageRaw = text(v, "stage");
  if (stageRaw) {
    stage = matchChoice(stageRaw, PROJECT_STAGES);
    if (!stage) issues.add("stage", `Unknown stage. Use ${PROJECT_STAGES.map((s) => s.label).join(", ")}`);
    else if (!project && !text(v, "project")) notes.stage = "Not saved without a project";
    else shown.stage = labelOf(PROJECT_STAGES, stage);
  }

  const invoiceDate = readDate(v, "invoiceDate", issues, null);
  if (invoiceDate) shown.invoiceDate = showDate(invoiceDate);
  const gstMoney = (key: "taxableAmount" | "cgst" | "sgst" | "igst" | "cess" | "gstTotal") => {
    const n = readMoney(v, key, issues, null);
    if (n !== undefined) shown[key] = showMoney(n);
    return n;
  };
  const gstinRaw = text(v, "gstin").replace(/\s+/g, "");
  if (gstinRaw) shown.gstin = gstinRaw.toUpperCase();
  const invoiceNumber = text(v, "invoiceNumber");

  // A single "GST" column: split into CGST and SGST halves, or IGST for a supplier in another state
  // (by the GSTIN), the same rule as the expense form. Separate CGST/SGST/IGST columns win.
  let cgst = gstMoney("cgst");
  let sgst = gstMoney("sgst");
  let igst = gstMoney("igst");
  const gstTotal = gstMoney("gstTotal");
  if (gstTotal !== undefined && gstTotal > 0) {
    if (cgst === undefined && sgst === undefined && igst === undefined) {
      if (isInterState(gstinRaw.toUpperCase())) {
        igst = round2(gstTotal);
        shown.igst = showMoney(igst);
      } else {
        cgst = round2(gstTotal / 2);
        sgst = round2(gstTotal - cgst);
        shown.cgst = showMoney(cgst);
        shown.sgst = showMoney(sgst);
      }
    } else if (Math.abs(Math.round(((cgst ?? 0) + (sgst ?? 0) + (igst ?? 0)) * 100) - Math.round(gstTotal * 100)) > 2) {
      // In paise: float sums like 30.86 + 30.86 - 61.73 must not count as a mismatch.
      issues.add("gstTotal", "GST total does not match CGST + SGST + IGST");
    }
  }

  const input: ExpenseFormInput = {
    vendor,
    projectId: project?.id,
    stage: project ? stage : undefined,
    category,
    description: optional(text(v, "description")),
    amount: amount ?? Number.NaN,
    date: date ?? "",
    paymentMethod,
    notes: optional(text(v, "notes")),
    gst: {
      gstin: optional(gstinRaw),
      invoiceNumber: optional(invoiceNumber),
      invoiceDate,
      taxableAmount: gstMoney("taxableAmount"),
      cgst,
      sgst,
      igst,
      cess: gstMoney("cess"),
      hsnSac: optional(text(v, "hsnSac")),
    },
  };
  const parsed = expenseFormSchema.safeParse(input);
  if (!parsed.success) addSchemaIssues(issues, parsed.error, { projectId: "project" });

  const dupKeys: string[] = [];
  if (date && vendor && amount !== undefined) dupKeys.push(dayKey("d", date, vendor, amount));
  if (vendor && invoiceNumber) dupKeys.push(refKey("i", vendor, invoiceNumber));
  return { input, issues, notes, shown, amount: round2(amount ?? 0), dupKeys };
}

/** A date range covering every row's date, for one query. */
function dateSpan(dates: (string | undefined)[]) {
  const sorted = dates.filter((d): d is string => Boolean(d)).sort();
  if (!sorted.length) return null;
  return { $gte: fromDateInput(sorted[0]), $lt: new Date(fromDateInput(sorted[sorted.length - 1]).getTime() + 86_400_000) };
}

/**
 * References are looked up ignoring case (INV-77A finds Inv-77a). A collation works without a
 * matching index, so this needs no database setup.
 */
const ANY_CASE = { locale: "en", strength: 2 } as const;
const unique = (refs: string[]) => [...new Set(refs)];

type Recorded = Map<string, string>;

/**
 * Records already saved that rows would repeat, keyed like dupKeys, with the record's number.
 * Every source counts: a bill already booked by a stock purchase is a duplicate in an expenses file.
 */
async function recordedExpenses(rows: Built<ExpenseFormInput>[]): Promise<Recorded> {
  const found: Recorded = new Map();
  const span = dateSpan(rows.map((r) => r.input.date || undefined));
  const invoices = rows.map((r) => r.input.gst.invoiceNumber).filter((s): s is string => Boolean(s));
  const [byDate, byInvoice] = await Promise.all([
    span ? Expense.find({ date: span }, { vendor: 1, amount: 1, date: 1, number: 1 }).lean() : Promise.resolve([]),
    invoices.length ? Expense.find({ "gst.invoiceNumber": { $in: unique(invoices) } }, { vendor: 1, number: 1, gst: 1 }).collation(ANY_CASE).lean() : Promise.resolve([]),
  ]);
  for (const e of byDate) found.set(dayKey("d", toDateInput(e.date), e.vendor, e.amount), e.number);
  for (const e of byInvoice) if (e.gst?.invoiceNumber) found.set(refKey("i", e.vendor, e.gst.invoiceNumber), e.number);
  return found;
}

const DUP_REASON: Record<string, string> = {
  d: "same date, vendor and amount",
  i: "same vendor and invoice number",
  r: "same client and reference",
};
const dupReason = (key: string, number: string) => `Looks like ${number} (${DUP_REASON[key[0]] ?? "same details"})`;

function firstRecorded(keys: string[], recorded: Recorded): string | undefined {
  for (const k of keys) {
    const n = recorded.get(k);
    if (n) return dupReason(k, n);
  }
  return undefined;
}

/* ---------- Income ---------- */

function buildIncome(v: Values, ctx: FinanceLookups, options: CsvOptions): Built<IncomeFormInput> {
  const issues = new Issues();
  const notes: Record<string, string> = {};
  const shown: Record<string, string> = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, s.trim()]));

  const date = readDate(v, "date", issues, "Date is required");
  if (date) shown.date = showDate(date);
  noteIfAhead(date, "date", notes);
  const client = text(v, "client");
  if (!client) issues.add("client", "Client is required");
  const amount = readMoney(v, "amount", issues, "Amount is required");
  if (amount !== undefined) shown.amount = showMoney(amount);

  const categoryRaw = text(v, "category");
  let category = matchChoice(categoryRaw, INCOME_CATEGORIES);
  if (!categoryRaw) {
    category = "other";
    notes.category = "Default";
  } else if (!category) issues.add("category", `Unknown category. Use ${INCOME_CATEGORIES.map((c) => c.label).join(", ")}`);
  shown.category = category ? labelOf(INCOME_CATEGORIES, category) : categoryRaw;

  const paymentMethod = readPaymentMethod(v, issues, notes, shown, options.defaultPaymentMethod);
  const project = readProject(v, ctx, issues, shown, false);
  const reference = text(v, "reference");

  const input: IncomeFormInput = {
    client,
    projectId: project?.id,
    category: category ?? "other",
    amount: amount ?? Number.NaN,
    date: date ?? "",
    paymentMethod,
    reference: optional(reference),
    notes: optional(text(v, "notes")),
  };
  const parsed = incomeFormSchema.safeParse(input);
  if (!parsed.success) addSchemaIssues(issues, parsed.error, { projectId: "project" });

  const dupKeys: string[] = [];
  if (date && client && amount !== undefined) dupKeys.push(dayKey("d", date, client, amount));
  if (client && reference) dupKeys.push(refKey("r", client, reference));
  return { input, issues, notes, shown, amount: round2(amount ?? 0), dupKeys };
}

async function recordedIncome(rows: Built<IncomeFormInput>[]): Promise<Recorded> {
  const found: Recorded = new Map();
  const span = dateSpan(rows.map((r) => r.input.date || undefined));
  const refs = rows.map((r) => r.input.reference).filter((s): s is string => Boolean(s));
  const [byDate, byRef] = await Promise.all([
    span ? Income.find({ date: span }, { client: 1, amount: 1, date: 1, number: 1 }).lean() : Promise.resolve([]),
    refs.length ? Income.find({ reference: { $in: unique(refs) } }, { client: 1, number: 1, reference: 1 }).collation(ANY_CASE).lean() : Promise.resolve([]),
  ]);
  for (const e of byDate) found.set(dayKey("d", toDateInput(e.date), e.client, e.amount), e.number);
  for (const e of byRef) if (e.reference) found.set(refKey("r", e.client, e.reference), e.number);
  return found;
}

/* ---------- Items ---------- */

type ItemRef = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  archived: boolean;
  subcategory: string | null;
  description: string | null;
  attributes: ItemAttribute[];
};

type ItemLookups = {
  categories: Map<string, { id: string; name: string }>;
  /** Category names the whole file uses (sent by the panel), by looseKey, with how often each appears. */
  fileCategories: Map<string, { name: string; count: number }>;
  /** Subcategories already in use, by looseKey, as first spelled. */
  subcategories: Map<string, string>;
  byName: Map<string, ItemRef[]>;
  bySku: Map<string, ItemRef>;
  /** Every SKU in use or set aside, archived items included (SKUs are unique across all items). */
  takenSkus: Set<string>;
  /** Stock purchases already saved, by purchaseKey, with what to call them. Filled by loadPurchases. */
  purchases: Map<string, string>;
};

/** The ledger's rounding of a unit price, so a key from a cell matches the stored movement. */
const roundPrice = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/** Day, quantity and unit price of a stock purchase: the same three again on one item look like a repeat. */
const stockSuffix = (ymd: string, quantity: number, unitPrice: number) => `${ymd}|${roundQty(quantity)}|${roundPrice(unitPrice)}`;
const purchaseKey = (itemId: string, suffix: string) => `${itemId}|${suffix}`;
const purchaseName = (quantity: number, unit: string, ymd: string) => `the purchase of ${formatNumber(quantity)} ${unit} on ${showDate(ymd)}`;

async function loadItemLookups(options: CsvOptions): Promise<ItemLookups> {
  const [categories, items] = await Promise.all([
    InventoryCategory.find({}, { name: 1 }).lean(),
    InventoryItem.find({}, { name: 1, sku: 1, unit: 1, archivedAt: 1, subcategory: 1, description: 1, attributes: 1 }).lean(),
  ]);
  const fileCategories = new Map<string, { name: string; count: number }>();
  for (const c of options.fileCategories) {
    const key = looseKey(c.name);
    if (!key) continue;
    const seen = fileCategories.get(key);
    fileCategories.set(key, { name: seen?.name ?? c.name.trim().replace(/\s+/g, " "), count: (seen?.count ?? 0) + c.count });
  }
  const ctx: ItemLookups = {
    categories: new Map(categories.map((c) => [looseKey(c.name), { id: String(c._id), name: c.name }])),
    fileCategories,
    subcategories: new Map(),
    byName: new Map(),
    bySku: new Map(),
    takenSkus: new Set(options.reservedSkus.map(normalizeSku)),
    purchases: new Map(),
  };
  for (const i of items) {
    addItem(ctx, {
      id: String(i._id),
      name: i.name,
      sku: i.sku,
      unit: i.unit ?? "pcs",
      archived: Boolean(i.archivedAt),
      subcategory: i.subcategory || null,
      description: i.description || null,
      attributes: cleanAttributes(i.attributes),
    });
  }
  return ctx;
}

/**
 * The purchase movements (opening stock included) that rows adding stock to existing items could
 * repeat: one query on the items' ids over the rows' days, which the item and date index serves.
 */
async function loadPurchases(ctx: ItemLookups, built: BuiltItem[]) {
  const wanted = built.filter((b) => b.action === "purchase" && b.existing && b.date);
  if (!wanted.length) return;
  const span = dateSpan(wanted.map((b) => b.date));
  if (!span) return;
  const ids = [...new Set(wanted.map((b) => b.existing!.id))];
  const units = new Map(wanted.map((b) => [b.existing!.id, b.existing!.unit]));
  const movements = await InventoryMovement.find(
    { item: { $in: ids }, type: "purchase", date: span },
    { item: 1, date: 1, quantity: 1, unitCost: 1 },
  ).lean();
  for (const m of movements) {
    const ymd = toDateInput(m.date);
    const id = String(m.item);
    ctx.purchases.set(purchaseKey(id, stockSuffix(ymd, m.quantity, m.unitCost ?? 0)), purchaseName(m.quantity, units.get(id) ?? "pcs", ymd));
  }
}

/** The saved purchase this row would repeat, if any. */
function repeatedPurchase(b: BuiltItem, ctx: ItemLookups): string | undefined {
  if (b.action !== "purchase" || !b.existing || !b.suffix) return undefined;
  const found = ctx.purchases.get(purchaseKey(b.existing.id, b.suffix));
  return found ? `Looks like ${found}, already saved` : undefined;
}

function addItem(ctx: ItemLookups, ref: ItemRef) {
  if (ref.sku) {
    ctx.takenSkus.add(ref.sku);
    // An active item wins the SKU over an archived one (only possible in data made before the unique index).
    if (!ctx.bySku.get(ref.sku) || ctx.bySku.get(ref.sku)!.archived) ctx.bySku.set(ref.sku, ref);
  }
  if (!ref.archived) {
    const key = normalizeItemName(ref.name ?? "");
    ctx.byName.set(key, [...(ctx.byName.get(key) ?? []), ref]);
    if (ref.subcategory && !ctx.subcategories.has(looseKey(ref.subcategory))) ctx.subcategories.set(looseKey(ref.subcategory), ref.subcategory);
  }
}

/** The same SKU pattern as the item form's suggestion: CATEGORY-NAME-001, unique against every SKU taken. */
function suggestSku(name: string, categoryName: string | undefined, taken: Set<string>): string {
  const letters = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n);
  const words = name.split(/\s+/).filter(Boolean);
  const namePart = words.length > 1 ? words.slice(0, 3).map((w) => letters(w, 3)).join("-") : letters(name, 6);
  const base = [categoryName ? letters(categoryName, 3) : "", namePart].filter(Boolean).join("-") || "ITEM";
  for (let n = 1; n < 10000; n++) {
    const candidate = `${base}-${String(n).padStart(3, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Free codes for a part whose SKU another part already has: the SKU plus its value when that is
 * short (RES-180KOHM), then RES-2, RES-3 and so on. Never one in use or set aside by the file.
 */
function alternateSkus(base: string, attributes: ItemAttribute[], taken: Set<string>): string[] {
  const out: string[] = [];
  const push = (candidate: string) => {
    if (candidate.length <= 64 && !taken.has(candidate) && !out.includes(candidate)) out.push(candidate);
  };
  const value = attributes.find((a) => /value|rating/.test(attributeKey(a.label)))?.value ?? "";
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact && compact.length <= 10) push(`${base}-${compact}`);
  for (let n = 2; out.length < 4 && n < 1000; n++) push(`${base}-${n}`);
  return out;
}

/** Edit distance with adjacent swaps, stopping early: anything over `max` returns max + 1. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2]! + 1);
      cur.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

const singular = (key: string) => key.replace(/(?<=[a-z]{2})(es|s)$/, "");
const digitsOf = (key: string) => key.replace(/\D/g, "");

/**
 * Whether `a` is a misspelling of `b`: the same words except one, and that word off by one letter
 * (two from 9 letters), with the same first letter and at least 6 letters. Numbers never differ
 * ("Relay module 5V" and "12V", "Bolts M3" and "M4" stay apart), nor do short or different words
 * ("Connectors male" and "female", "Cable" and "Table").
 */
function isTypoOf(a: string, b: string): boolean {
  if (digitsOf(a) !== digitsOf(b)) return false;
  const wa = a.split(" ");
  const wb = b.split(" ");
  if (wa.length !== wb.length) return false;
  const differing = wa.map((w, i) => [w, wb[i]!] as const).filter(([x, y]) => x !== y);
  if (differing.length !== 1) return false;
  const [x, y] = differing[0]!;
  if (Math.min(x.length, y.length) < 6 || x[0] !== y[0]) return false;
  const max = Math.min(x.length, y.length) >= 9 ? 2 : 1;
  return editDistance(x, y, max) <= max;
}

/** The single candidate `key` is a plural or a misspelling of; none when no candidate or several are. */
function nearestName<T>(key: string, candidates: Iterable<[string, T]>): T | undefined {
  const list = [...candidates].filter(([candidate]) => candidate !== key);
  const plural = list.filter(([candidate]) => singular(candidate) === singular(key) && digitsOf(candidate) === digitsOf(key));
  if (plural.length === 1) return plural[0]![1];
  const typos = list.filter(([candidate]) => isTypoOf(key, candidate));
  return typos.length === 1 ? typos[0]![1] : undefined;
}

type CategoryRead = { id?: string; name: string; isNew: boolean; readAs: boolean };

/**
 * The category a cell names: an inventory category (same spelling ignoring case and spaces, or a
 * close misspelling of one), else the spelling the file uses more often ("Electronic moidule" once
 * next to "Electronic Module" twelve times), else a new category with the cell's own name.
 */
function readCategory(raw: string, ctx: ItemLookups): CategoryRead {
  const key = looseKey(raw);
  const exact = ctx.categories.get(key);
  if (exact) return { id: exact.id, name: exact.name, isNew: false, readAs: false };
  // Not against a category the file itself names: rows spelt that way are that category, and the
  // import (which creates the file's new categories as it goes) must read the file as the check did.
  const near = nearestName(
    key,
    [...ctx.categories].filter(([k]) => !ctx.fileCategories.has(k)),
  );
  if (near) return { id: near.id, name: near.name, isNew: false, readAs: true };
  const own = ctx.fileCategories.get(key)?.count ?? 1;
  const usual = nearestName(
    key,
    [...ctx.fileCategories].filter(([, c]) => c.count > own),
  );
  if (usual) {
    const known = ctx.categories.get(looseKey(usual.name));
    return known ? { id: known.id, name: known.name, isNew: false, readAs: true } : { name: usual.name, isNew: true, readAs: true };
  }
  return { name: raw, isNew: true, readAs: false };
}

/** The item form's limit for a description, so a filled one can still be saved from the form. */
const DESCRIPTION_MAX = 2000;

/** What a sheet row adds to an item already in inventory: only details the item does not have yet. */
type DetailFill = { subcategory?: string; description?: string; attributes: ItemAttribute[] };

function missingDetails(item: ItemRef, row: { subcategory?: string; description?: string; attributes: ItemAttribute[] }): DetailFill | undefined {
  const have = new Set(item.attributes.map((a) => attributeKey(a.label)));
  const room = Math.max(0, MAX_ATTRIBUTES - item.attributes.length);
  const fill: DetailFill = {
    subcategory: !item.subcategory && row.subcategory ? row.subcategory.slice(0, SUBCATEGORY_MAX) : undefined,
    description: !item.description && row.description ? row.description.slice(0, DESCRIPTION_MAX) : undefined,
    attributes: row.attributes.filter((a) => !have.has(attributeKey(a.label))).slice(0, room),
  };
  return fill.subcategory || fill.description || fill.attributes.length ? fill : undefined;
}

const fillLabels = (fill: DetailFill) =>
  [fill.subcategory ? "Subcategory" : "", fill.description ? "Description" : "", ...fill.attributes.map((a) => a.label)].filter(Boolean).join(", ");

type BuiltItem = {
  issues: Issues;
  notes: Record<string, string>;
  shown: Record<string, string>;
  action: "create" | "purchase" | "update" | "skip";
  nameKey: string;
  sku: string;
  skuGiven: boolean;
  existing?: ItemRef;
  /** Details an existing item gets from this row (never replacing what it has). */
  fill?: DetailFill;
  newCategory?: string;
  quantity: number;
  /** Quantity times unit price. */
  cost: number;
  /** The stock purchase expense this row adds. */
  amount: number;
  /** The purchase date (yyyy-mm-dd) when the row adds stock. */
  date?: string;
  /** stockSuffix of the stock the row adds, when it adds any. */
  suffix?: string;
  reason?: string;
  paymentMethod: PurchasePaymentMethod;
  traits: { subcategory?: string; attributes: ItemAttribute[] };
  altSkus: string[];
  /** Another item already has the SKU the row gives, and the row is not that item. */
  skuTakenBy?: ItemRef;
  /** A quantity without a unit price: stock on hand at ₹0, no expense. */
  noPrice: boolean;
  /** createItem input, without the category when it still has to be created. */
  create: ItemFormInput;
  /** purchaseStockAction input. */
  purchase?: PurchaseFormInput;
};

const today = () => toDateInput(new Date());
const IMPORT_NOTE = "Imported from a CSV file";

/** Same item name: equal ignoring case and spaces, or the same letters and words ("Wi-Fi switch", "wifi switch"). */
const sameItemName = (a: string, b: string) => matchItemName(a, b) !== null;

function buildItem(row: CsvRowInput, ctx: ItemLookups, options: CsvOptions, mode: "preview" | "import"): BuiltItem {
  const v = row.values;
  const issues = new Issues();
  const notes: Record<string, string> = {};
  const shown: Record<string, string> = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, s.trim()]));

  const name = text(v, "name").replace(/\s+/g, " ");
  if (!name) issues.add("name", "Name is required");
  if (name) shown.name = name;
  const nameKey = normalizeItemName(name);
  const skuRaw = text(v, "sku");
  const skuGiven = Boolean(skuRaw);
  let sku = skuGiven ? normalizeSku(skuRaw) : "";
  if (skuGiven) shown.sku = sku;

  let categoryId: string | undefined;
  let categoryName: string | undefined;
  let newCategory: string | undefined;
  const categoryRaw = text(v, "category").replace(/\s+/g, " ");
  if (categoryRaw) {
    const c = readCategory(categoryRaw, ctx);
    if (c.name.length > 80) issues.add("category", "A category name has at most 80 characters");
    else {
      categoryName = c.name;
      shown.category = c.name;
      if (c.isNew) {
        newCategory = c.name;
        notes.category = c.readAs ? `Read as ${c.name} (new category)` : "New category";
      } else {
        categoryId = c.id;
        if (c.readAs) notes.category = `Read as ${c.name}`;
      }
    }
  }

  const subcategoryRaw = text(v, "subcategory").replace(/\s+/g, " ");
  const subcategory = subcategoryRaw ? (ctx.subcategories.get(looseKey(subcategoryRaw)) ?? subcategoryRaw) : undefined;
  if (subcategory) shown.subcategory = subcategory;
  const description = optional(text(v, "description"));
  const attributes = cleanAttributes(row.extras);
  for (const a of attributes) shown[`detail:${a.label}`] = a.value;
  if ((row.extras ?? []).filter((a) => a.value.trim()).length > attributes.length && attributes.length >= MAX_ATTRIBUTES) {
    notes.attributes = `Only the first ${MAX_ATTRIBUTES} details are kept`;
  }
  const traits = { subcategory, attributes };

  let unit: ItemFormInput["unit"] = "pcs";
  const unitRaw = text(v, "unit");
  if (!unitRaw) notes.unit = "Default";
  else {
    const found = matchChoice(unitRaw, INVENTORY_UNITS, UNIT_ALIASES as Record<string, ItemFormInput["unit"]>);
    if (!found) issues.add("unit", `Unknown unit. Use ${INVENTORY_UNITS.map((u) => u.value).join(", ")}`);
    else unit = found;
  }
  shown.unit = unit;

  const minStock = readNumber(v, "minStock", issues);
  const quantity = readNumber(v, "quantity", issues);
  if (quantity !== undefined) shown.quantity = formatNumber(quantity);
  const unitPrice = readMoney(v, "unitPrice", issues, null);
  if (unitPrice !== undefined) shown.unitPrice = showMoney(unitPrice);
  let purchaseDate = readDate(v, "purchaseDate", issues, null);
  const paymentMethod = readPaymentMethod(v, issues, notes, shown, options.defaultPaymentMethod);
  const vendor = optional(text(v, "vendor"));

  const qty = quantity ?? 0;
  // A parts list often has no price column: its stock is on hand at ₹0, with no expense (a later
  // purchase sets a price; the average cost then blends with these ₹0 units). In a sheet that has a
  // price column, a blank price is a missing value and stops the row, as before.
  const noPrice = qty > 0 && unitPrice === undefined && !options.priceColumn;
  // Bought stock is bought on a day; an empty date means today, as on the Purchase stock screen.
  if (!purchaseDate && qty > 0 && !noPrice) {
    purchaseDate = today();
    notes.purchaseDate = "Today";
  }
  if (purchaseDate) shown.purchaseDate = showDate(purchaseDate);
  noteIfAhead(purchaseDate, "purchaseDate", notes);

  // The same item already in inventory. Two parts with one name are told apart by their details (a
  // 110 ohm and a 180K ohm resistor). Nothing is guessed: when the SKU and the name point different
  // ways, or a name alone cannot confirm the part, the row stops with what to fix.
  const bySku = sku ? ctx.bySku.get(sku) : undefined;
  const compatible = nameKey ? (ctx.byName.get(nameKey) ?? []).filter((i) => !partDifference(traits, i)) : [];
  let existing: ItemRef | undefined;
  let skuTakenBy: ItemRef | undefined;
  if (bySku?.archived) {
    issues.add("sku", `SKU ${sku} belongs to an archived item`);
  } else if (bySku && sameItemName(bySku.name, name) && !partDifference(traits, bySku)) {
    existing = bySku;
  } else if (bySku && compatible.length === 1 && nameMatchConfirmed(traits, compatible[0]!)) {
    // The file's ID is on another part (reused in an older sheet), but this part is in inventory under
    // its own code, matched by name and details: re-importing a parts list finds it again.
    existing = compatible[0];
    notes.sku = `${sku} is ${bySku.name}; matched ${existing.sku} by name and details`;
  } else if (bySku && sameItemName(bySku.name, name)) {
    // Same name, a detail differs: another part given the same ID (the review gives it a new code).
    skuTakenBy = bySku;
  } else if (bySku) {
    // Another name under this SKU: the item may have been renamed, or the ID is wrong. Not guessed.
    issues.add("sku", `SKU ${sku} is ${bySku.name} in inventory, not ${name || "this name"}. Correct the SKU or the name in the file.`);
  } else if (compatible.length > 1) {
    issues.add("name", `${compatible.length} items are named ${name} with these details. Add the SKU of the one to add stock to.`);
  } else if (compatible.length === 1) {
    const match = compatible[0]!;
    if (skuGiven) issues.add("sku", `${match.name} already has SKU ${match.sku}`);
    else if (!nameMatchConfirmed(traits, match)) {
      // "Metal film resistor" in stock without a value may be any value: the SKU confirms it is this one.
      issues.add("name", `${match.name} (${match.sku}) is in inventory without details to compare. Put SKU ${match.sku} in this row to add to it.`);
    } else existing = match;
  }
  // Offered for any given SKU: the review also uses them when an earlier row of the file has the SKU.
  const altSkus = sku && !existing ? alternateSkus(sku, attributes, ctx.takenSkus) : [];
  if (!existing && skuTakenBy && mode === "import") {
    // The panel sends the new code it showed; a taken SKU here means it was taken since the check.
    issues.add("sku", `SKU ${sku} is already ${skuTakenBy.name}`);
  }

  const create: ItemFormInput = {
    name,
    sku: sku || "PENDING",
    categoryId,
    subcategory,
    attributes,
    unit,
    minStock,
    vendor,
    purchaseDate,
    description,
    location: optional(text(v, "location")),
    openingQuantity: quantity,
    openingUnitPrice: noPrice ? 0 : unitPrice,
    ...(noPrice ? { openingAsPurchase: false } : {}),
  };

  let action: BuiltItem["action"] = "create";
  let amount = 0;
  let reason: string | undefined;
  let purchase: PurchaseFormInput | undefined;
  let fill: DetailFill | undefined;
  if (existing) {
    sku = existing.sku;
    shown.sku = existing.sku;
    fill = missingDetails(existing, { subcategory, description, attributes });
    const fills = fill ? ` Fills its empty details: ${fillLabels(fill)}.` : "";
    if (qty > 0 && !noPrice) {
      action = "purchase";
      if (unitPrice === undefined) issues.add("unitPrice", "Enter the unit price of the stock bought");
      purchase = {
        itemId: existing.id,
        quantity: qty,
        unitPrice: unitPrice ?? Number.NaN,
        vendor,
        date: purchaseDate ?? today(),
        invoice: {},
        note: IMPORT_NOTE,
      };
      const parsed = purchaseFormSchema.safeParse(purchase);
      if (!parsed.success) addSchemaIssues(issues, parsed.error, { itemId: "name", date: "purchaseDate" });
      amount = round2(qty * (unitPrice ?? 0));
      reason = `Adds stock to ${existing.name}. Its vendor and purchase date are updated; its name, category, location and the rest stay as they are.${fills}`;
    } else if (noPrice) {
      action = fill ? "update" : "skip";
      notes.quantity = "Not added: no unit price";
      reason = `Already in inventory as ${existing.name} (${existing.sku}). The sheet has no unit price, so its quantity is not added; use Purchase stock for that.${fills}`;
    } else {
      action = fill ? "update" : "skip";
      reason = fill
        ? `Already in inventory as ${existing.name} (${existing.sku}).${fills} Nothing else changes.`
        : `Already in inventory as ${existing.name} (${existing.sku}), with no quantity to add`;
    }
  } else {
    if (!skuGiven && name) {
      sku = suggestSku(name, categoryName, ctx.takenSkus);
      notes.sku = "Suggested";
      shown.sku = sku;
    }
    // A SKU another part has is replaced in the review (or the row stopped there): check with a free one.
    create.sku = (skuTakenBy ? altSkus[0] : sku) || "PENDING";
    const parsed = itemFormSchema.safeParse(create);
    if (!parsed.success) {
      addSchemaIssues(issues, parsed.error, { categoryId: "category", openingQuantity: "quantity", openingUnitPrice: "unitPrice" });
    }
    if (noPrice) {
      notes.unitPrice = "None: stock on hand at ₹0, no expense";
      shown.unitPrice = "";
    }
    // Whether opening stock is an expense is the admin's switch in the review (review.ts), which also sets the note.
    amount = options.recordAsPurchases && qty > 0 && !noPrice ? round2(qty * (unitPrice ?? 0)) : 0;
  }

  const cost = round2(qty * (unitPrice ?? 0));
  return {
    issues,
    notes,
    shown,
    action,
    nameKey,
    sku,
    skuGiven,
    existing,
    fill,
    newCategory,
    quantity: qty,
    cost,
    amount,
    date: qty > 0 && !noPrice ? purchaseDate : undefined,
    suffix: qty > 0 && !noPrice && purchaseDate ? stockSuffix(purchaseDate, qty, unitPrice ?? 0) : undefined,
    reason,
    paymentMethod,
    traits,
    altSkus,
    skuTakenBy: existing ? undefined : skuTakenBy,
    noPrice,
    create,
    purchase,
  };
}

/** Writes details an existing item lacks, without replacing any it has (checked again on the stored item). */
async function fillItemDetails(itemId: string, fill: DetailFill): Promise<string[]> {
  const written: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await InventoryItem.findOne({ _id: itemId, archivedAt: null }, { subcategory: 1, description: 1, attributes: 1, updatedAt: 1 }).lean();
    if (!item) return written;
    const current = cleanAttributes(item.attributes);
    const have = new Set(current.map((a) => attributeKey(a.label)));
    const add = fill.attributes.filter((a) => !have.has(attributeKey(a.label))).slice(0, Math.max(0, MAX_ATTRIBUTES - current.length));
    const set: Record<string, unknown> = {};
    if (fill.subcategory && !item.subcategory) set.subcategory = fill.subcategory;
    if (fill.description && !item.description) set.description = fill.description;
    if (add.length) set.attributes = [...(item.attributes ?? []), ...add];
    if (!Object.keys(set).length) return written;
    // Only over the copy just read: an edit saved meanwhile is never overwritten (read again instead).
    const res = await InventoryItem.updateOne({ _id: itemId, updatedAt: item.updatedAt }, { $set: set });
    if (res.modifiedCount) {
      return [set.subcategory ? "Subcategory" : "", set.description ? "Description" : "", ...add.map((a) => a.label)].filter(Boolean);
    }
  }
  return written;
}

/* ---------- Dry run ---------- */

export async function previewRows(kind: CsvImportKind, rows: CsvRowInput[], options: CsvOptions): Promise<PreviewRow[]> {
  if (kind === "items") {
    const ctx = await loadItemLookups(options);
    const built = rows.map((row) => {
      const b = buildItem(row, ctx, options, "preview");
      // Later rows in this request must not be offered the same suggested SKU.
      if (b.action === "create" && b.sku) ctx.takenSkus.add(b.sku);
      return b;
    });
    await loadPurchases(ctx, built);
    return rows.map((row, i) => {
      const b = built[i];
      const repeat = b.issues.any ? undefined : repeatedPurchase(b, ctx);
      // Rows of this file that add the same stock to the same item are found in review.ts by this key.
      const identity = b.existing ? b.existing.id : `new:${b.nameKey}`;
      return {
        line: row.line,
        status: b.issues.any ? "error" : b.action === "skip" ? "skip" : repeat ? "duplicate" : "ready",
        errors: b.issues.list,
        notes: b.notes,
        shown: b.shown,
        reason: repeat ?? b.reason,
        dupKeys: b.suffix && b.action !== "skip" ? [`p|${identity}|${b.suffix}`] : [],
        amount: b.amount,
        date: b.date,
        item: {
          action: b.action,
          nameKey: b.nameKey,
          sku: b.sku,
          skuGiven: b.skuGiven,
          existing: b.existing ? { id: b.existing.id, name: b.existing.name, sku: b.existing.sku } : undefined,
          newCategory: b.newCategory,
          quantity: b.quantity,
          cost: b.cost,
          traits: b.traits,
          altSkus: b.altSkus,
          // Another item already has the file's SKU: the review gives this part a new code or stops it.
          ...(b.skuTakenBy ? { skuTakenBy: b.skuTakenBy.archived ? "an archived item" : b.skuTakenBy.name } : {}),
          noPrice: b.noPrice || undefined,
        },
      };
    });
  }

  const ctx = await loadFinanceLookups(kind === "expenses");
  const built = rows.map((row) => (kind === "expenses" ? buildExpense(row.values, ctx, options) : buildIncome(row.values, ctx, options)));
  const recorded =
    kind === "expenses" ? await recordedExpenses(built as Built<ExpenseFormInput>[]) : await recordedIncome(built as Built<IncomeFormInput>[]);
  return rows.map((row, i) => {
    const b = built[i];
    const reason = b.issues.any ? undefined : firstRecorded(b.dupKeys, recorded);
    return {
      line: row.line,
      status: b.issues.any ? "error" : reason ? "duplicate" : "ready",
      errors: b.issues.list,
      notes: b.notes,
      shown: b.shown,
      reason,
      dupKeys: b.dupKeys,
      amount: b.amount,
      date: b.input.date || undefined,
    };
  });
}

/* ---------- Import ---------- */

const describeIssues = (kind: CsvImportKind, issues: RowIssue[]) => issues.map((i) => `${fieldLabel(kind, i.field)}: ${i.message}`).join("; ");

function failure(kind: CsvImportKind, line: number, result: Extract<ActionResult<unknown>, { ok: false }>): ImportRowResult {
  const fields = Object.entries(result.fieldErrors ?? {})
    .filter(([, m]) => m?.[0] && m[0] !== result.error)
    .map(([f, m]) => `${fieldLabel(kind, f)}: ${m![0]}`);
  return { line, status: "failed", message: [result.error, ...fields].join("; ") };
}

async function importFinanceRows(kind: "expenses" | "income", rows: CsvRowInput[], options: CsvOptions): Promise<ImportRowResult[]> {
  const ctx = await loadFinanceLookups(kind === "expenses");
  const built = rows.map((row) => (kind === "expenses" ? buildExpense(row.values, ctx, options) : buildIncome(row.values, ctx, options)));
  // Checked again here, not taken from the preview: the data may have changed since, and a batch
  // sent twice must not save its rows twice.
  const recorded = options.importDuplicates
    ? new Map<string, string>()
    : kind === "expenses"
      ? await recordedExpenses(built as Built<ExpenseFormInput>[])
      : await recordedIncome(built as Built<IncomeFormInput>[]);
  const results: ImportRowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { line } = rows[i];
    const b = built[i];
    try {
      if (b.issues.any) {
        results.push({ line, status: "failed", message: describeIssues(kind, b.issues.list) });
        continue;
      }
      const dup = options.importDuplicates ? undefined : firstRecorded(b.dupKeys, recorded);
      if (dup) {
        results.push({ line, status: "skipped", message: dup, skipReason: "duplicate" });
        continue;
      }
      const result =
        kind === "expenses" ? await createExpense(b.input as ExpenseFormInput) : await createIncome(b.input as IncomeFormInput);
      if (!result.ok) {
        results.push(failure(kind, line, result));
        continue;
      }
      // Later rows of the file that repeat this one are duplicates too.
      for (const k of b.dupKeys) if (!recorded.has(k)) recorded.set(k, result.data.number);
      results.push({ line, status: "imported", message: `Saved as ${result.data.number}`, ref: result.data.number, amount: b.amount });
    } catch (error) {
      console.error("[csv-import] row failed", error);
      results.push({ line, status: "failed", message: "Something went wrong with this row. Try it again." });
    }
  }
  return results;
}

/** Finds or creates an inventory category for the import. Another person may create it at the same moment. */
async function ensureCategory(name: string, ctx: ItemLookups, created: string[]): Promise<{ id: string } | { error: string }> {
  const known = ctx.categories.get(looseKey(name));
  if (known) return { id: known.id };
  const color = CATEGORY_COLORS[(ctx.categories.size + created.length) % CATEGORY_COLORS.length];
  const result = await createCategory({ name, color });
  if (result.ok) {
    ctx.categories.set(looseKey(name), { id: result.data.id, name });
    created.push(name);
    return { id: result.data.id };
  }
  const again = await InventoryCategory.findOne({ name }).collation({ locale: "en", strength: 2 }).lean();
  if (again) {
    ctx.categories.set(looseKey(name), { id: String(again._id), name: again.name });
    return { id: String(again._id) };
  }
  return { error: result.error };
}

async function importItemRows(rows: CsvRowInput[], options: CsvOptions): Promise<ImportResult> {
  const ctx = await loadItemLookups(options);
  // Checked again here, not taken from the preview: a row re-imported from the "Rows not imported"
  // file, or a batch sent twice, must not add its stock and its expense twice.
  if (!options.importDuplicates) await loadPurchases(ctx, rows.map((r) => buildItem(r, ctx, options, "import")));
  const createdCategories: string[] = [];
  const results: ImportRowResult[] = [];
  for (const row of rows) {
    const { line } = row;
    try {
      // Built one at a time against lookups that include the rows saved before it, so a second row
      // for a new item adds stock to the item the first row created.
      const b = buildItem(row, ctx, options, "import");
      if (b.issues.any) {
        results.push({ line, status: "failed", message: describeIssues("items", b.issues.list) });
        continue;
      }
      if (b.action === "skip") {
        results.push({ line, status: "skipped", message: b.reason ?? "Nothing to add", skipReason: "nothing" });
        continue;
      }
      if (b.action === "update" && b.existing && b.fill) {
        const written = await fillItemDetails(b.existing.id, b.fill);
        if (!written.length) {
          results.push({ line, status: "skipped", message: `${b.existing.name} already has these details`, skipReason: "nothing" });
          continue;
        }
        b.existing.attributes = [...b.existing.attributes, ...b.fill.attributes];
        results.push({ line, status: "imported", message: `Filled details of ${b.existing.name}: ${written.join(", ")}`, ref: b.existing.name, amount: 0 });
        continue;
      }
      if (b.action === "purchase" && b.purchase && b.existing) {
        const repeat = options.importDuplicates ? undefined : repeatedPurchase(b, ctx);
        if (repeat) {
          results.push({ line, status: "skipped", message: repeat, skipReason: "duplicate" });
          continue;
        }
        const result = await purchaseStockAction({ ...b.purchase, paymentMethod: b.paymentMethod });
        if (!result.ok) {
          results.push(failure("items", line, result));
          continue;
        }
        if (b.suffix && b.date) {
          ctx.purchases.set(purchaseKey(b.existing.id, b.suffix), purchaseName(b.quantity, b.existing.unit, b.date));
        }
        const written = b.fill ? await fillItemDetails(b.existing.id, b.fill) : [];
        results.push({
          line,
          status: "imported",
          message: `Added ${formatNumber(result.data.quantity)} ${result.data.unit} to ${result.data.itemName}${written.length ? `; filled ${written.join(", ")}` : ""}`,
          ref: b.existing.name,
          amount: result.data.total,
        });
        continue;
      }
      let categoryId = b.create.categoryId;
      if (b.newCategory) {
        if (!options.createCategories) {
          results.push({ line, status: "failed", message: `Category: No category named ${b.newCategory}` });
          continue;
        }
        const c = await ensureCategory(b.newCategory, ctx, createdCategories);
        if ("error" in c) {
          results.push({ line, status: "failed", message: `Category: ${c.error}` });
          continue;
        }
        categoryId = c.id;
      }
      const qty = b.create.openingQuantity ?? 0;
      const result = await createItem({
        ...b.create,
        categoryId,
        // No price: stock on hand at ₹0, never an expense.
        openingAsPurchase: b.noPrice ? false : options.recordAsPurchases,
        openingPaymentMethod: b.paymentMethod,
      });
      if (!result.ok) {
        results.push(failure("items", line, result));
        continue;
      }
      addItem(ctx, {
        id: result.data.id,
        name: b.create.name,
        sku: b.sku,
        unit: b.create.unit,
        archived: false,
        subcategory: b.traits.subcategory ?? null,
        description: b.create.description ?? null,
        attributes: b.traits.attributes,
      });
      // Its opening stock is a purchase movement, so a later row repeating it is caught too.
      if (qty > 0 && b.suffix && b.date) ctx.purchases.set(purchaseKey(result.data.id, b.suffix), purchaseName(qty, b.create.unit, b.date));
      const booked = options.recordAsPurchases && qty > 0 && !b.noPrice ? b.amount : 0;
      results.push({
        line,
        status: "imported",
        message: `New item ${b.create.name} (${b.sku})${qty > 0 ? `, ${formatNumber(qty)} ${b.create.unit} in stock${b.noPrice ? " at ₹0" : ""}` : ""}`,
        ref: b.create.name,
        amount: booked,
      });
    } catch (error) {
      console.error("[csv-import] item row failed", error);
      results.push({ line, status: "failed", message: "Something went wrong with this row. Try it again." });
    }
  }
  return { rows: results, createdCategories };
}

export async function importRows(kind: CsvImportKind, rows: CsvRowInput[], options: CsvOptions): Promise<ImportResult> {
  if (kind === "items") return importItemRows(rows, options);
  return { rows: await importFinanceRows(kind, rows, options), createdCategories: [] };
}
