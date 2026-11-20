import { z } from "zod";
import { purchasePaymentMethod } from "@/features/inventory/ledger/schemas";
import { CSV_IMPORT_KINDS, IMPORT_BATCH, PREVIEW_CHUNK } from "./fields";
import type { ItemAttribute } from "@/features/inventory/items/attributes";

/** What the CSV import actions accept and return. Client-safe. */

const csvRow = z.object({
  /** The row's line in the file, so messages and the failed-rows file can point at it. */
  line: z.number().int().min(1).max(1_000_000),
  /** Cell text by field key (only mapped columns). */
  values: z.record(z.string().max(40), z.string().max(5000)),
  /** Items: the cells of columns kept as details, labelled by their header. */
  extras: z
    .array(z.object({ label: z.string().max(200), value: z.string().max(5000) }))
    .max(60)
    .optional(),
});
export type CsvRowInput = z.infer<typeof csvRow>;

export const csvOptionsSchema = z.object({
  /** Used for rows whose payment method cell is empty. */
  defaultPaymentMethod: purchasePaymentMethod.default("bank_transfer"),
  /** Items: book opening stock of new items as purchases (adds expenses). Existing items always get a purchase. */
  recordAsPurchases: z.boolean().default(true),
  /** Create the categories the file names that do not exist yet (inventory or expense categories). */
  createCategories: z.boolean().default(true),
  /** Save rows that look like ones already recorded (for items: the same stock bought on the same day at the same price). */
  importDuplicates: z.boolean().default(false),
  /** Items: SKUs the file already uses or the preview suggested, so a suggestion never repeats one. */
  reservedSkus: z.array(z.string().max(64)).max(4000).default([]),
  /**
   * Items: a SKU the file gives to two different parts (or that another item already has) is given
   * a new code for the later part instead of stopping the row.
   */
  renameReusedIds: z.boolean().default(true),
  /**
   * Items: the file has a unit price column. Without one (a parts list), quantities are stock on hand
   * at ₹0; with one, a row with a quantity and a blank price needs a fix.
   */
  priceColumn: z.boolean().default(true),
  /** Items: every category name in the file with how often it appears, to read a misspelt one as the usual spelling. */
  fileCategories: z
    .array(z.object({ name: z.string().max(200), count: z.number().int().min(1).max(100_000) }))
    .max(2000)
    .default([]),
});
export type CsvOptionsInput = z.input<typeof csvOptionsSchema>;
export type CsvOptions = z.output<typeof csvOptionsSchema>;

const kind = z.enum(CSV_IMPORT_KINDS);

export const csvPreviewSchema = z.object({
  kind,
  rows: z.array(csvRow).min(1).max(PREVIEW_CHUNK),
  options: csvOptionsSchema,
});

export const csvImportSchema = z
  .object({
    kind,
    rows: z.array(csvRow).min(1).max(Math.max(...Object.values(IMPORT_BATCH))),
    options: csvOptionsSchema,
  })
  .refine((v) => v.rows.length <= IMPORT_BATCH[v.kind], "Too many rows in one batch");

export type RowIssue = { field: string; message: string };

/** One row of the dry run. */
export type PreviewRow = {
  line: number;
  /** ready: can be saved. error: something to fix. duplicate: looks recorded already (for items: the same purchase). skip: nothing to do (an item already in stock with no quantity). */
  status: "ready" | "error" | "duplicate" | "skip";
  errors: RowIssue[];
  /** Values the import filled in or read differently from the cell (a default, a suggested SKU), by field. */
  notes: Record<string, string>;
  /** How each field will be saved, for the preview table (a category's name, a date as 5 Nov 2026). */
  shown: Record<string, string>;
  /** Why the row is a duplicate or skipped. */
  reason?: string;
  /** Keys that find the same record again in the file (date, party and amount; party and invoice; for items, the item, day, quantity and price). */
  dupKeys: string[];
  /** The amount the row records (expenses, income) or the stock purchase expense it adds (items). */
  amount: number;
  /** The day the record is booked on (yyyy-mm-dd), when known. */
  date?: string;
  /** Expenses: a category the file names that does not exist yet; the import creates it. */
  newCategory?: string;
  /** Items only. */
  item?: {
    /**
     * create: a new item. purchase: stock added to an item already in inventory. update: an item
     * already in inventory gets the details it lacks (never changing ones it has). skip: nothing to do.
     */
    action: "create" | "purchase" | "update" | "skip";
    nameKey: string;
    /** The SKU from the file, or the suggested one for a new item. */
    sku: string;
    skuGiven: boolean;
    /** The existing item stock is added to. */
    existing?: { id: string; name: string; sku: string };
    /** A category the file names that does not exist yet. */
    newCategory?: string;
    /** Quantity in the row (0 when none). */
    quantity: number;
    /** Quantity times unit price: the expense a purchase of this stock books. */
    cost: number;
    /** Subcategory and details, to tell two same-named parts in the file apart. */
    traits: { subcategory?: string; attributes: ItemAttribute[] };
    /** Free codes for this part if its SKU turns out to be taken by another part (first is preferred). */
    altSkus: string[];
    /** The item in inventory that already has the file's SKU (this row is another part). */
    skuTakenBy?: string;
    /** The review gave this row a new SKU; the import sends it instead of the file's. */
    renamedFrom?: string;
    /** The row has a quantity but no unit price: stock on hand at ₹0, no expense. */
    noPrice?: boolean;
  };
};

export type PreviewResult = { rows: PreviewRow[] };

export type ImportRowResult = {
  line: number;
  status: "imported" | "skipped" | "failed";
  message: string;
  /** The saved record: EXP-2026-00042, an item name. */
  ref?: string;
  /** Money booked as an expense or income by this row. */
  amount?: number;
  /** Why a skipped row was skipped: it repeats a saved record, or (items) it has no stock to add. */
  skipReason?: "duplicate" | "nothing";
};

export type ImportResult = { rows: ImportRowResult[]; createdCategories: string[] };
