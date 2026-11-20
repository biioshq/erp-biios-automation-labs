/**
 * Turns the server's dry run into what the admin reviews: rows that repeat an earlier row of the
 * same file, item rows for an item an earlier row creates, and the options that change a row's
 * outcome without checking again (create missing categories, book opening stock as purchases).
 * Client-safe and pure.
 */

import type { CsvImportKind } from "./fields";
import type { ImportRowResult, PreviewRow } from "./schemas";
import { toCsv } from "./parse";

export type ReviewOptions = { createCategories: boolean; recordAsPurchases: boolean };

/** A preview row with the in-file checks and the options applied. */
export function reviewRows(kind: CsvImportKind, rows: PreviewRow[], options: ReviewOptions): PreviewRow[] {
  return kind === "items" ? reviewItems(rows, options) : reviewFinance(rows);
}

function reviewFinance(rows: PreviewRow[]): PreviewRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.status === "error") return row;
    let out = row;
    if (row.status === "ready") {
      const earlier = row.dupKeys.map((k) => seen.get(k)).find((l) => l !== undefined);
      if (earlier !== undefined) out = { ...row, status: "duplicate", reason: `Same as row ${earlier} of this file` };
    }
    for (const k of row.dupKeys) if (!seen.has(k)) seen.set(k, row.line);
    return out;
  });
}

function reviewItems(rows: PreviewRow[], options: ReviewOptions): PreviewRow[] {
  const byName = new Map<string, { line: number; sku: string }>();
  const bySku = new Map<string, { line: number; nameKey: string }>();
  /** Stock added by earlier rows (item, day, quantity, price), as the import skips a repeat of it. */
  const stock = new Map<string, number>();
  return rows.map((row) => {
    const item = row.item;
    if (!item) return row;
    let out: PreviewRow = { ...row, item: { ...item }, errors: [...row.errors], notes: { ...row.notes }, shown: { ...row.shown } };
    if (row.status !== "error" && item.action === "create") {
      const first = byName.get(item.nameKey);
      const skuOwner = item.skuGiven ? bySku.get(item.sku) : undefined;
      if (first && item.skuGiven && item.sku !== first.sku) {
        // The import would find the item by name and refuse the other SKU, so say so now.
        out.status = "error";
        out.errors.push({ field: "sku", message: `The item in row ${first.line} has SKU ${first.sku}` });
      } else if (first) {
        // The earlier row creates this item; this one adds its stock to it (or has nothing to add).
        out.item!.sku = first.sku;
        out.shown.sku = first.sku;
        delete out.notes.sku;
        if (item.quantity > 0) {
          out.item!.action = "purchase";
          out.reason = `Adds stock to the item created in row ${first.line}`;
        } else {
          out = { ...out, status: "skip", reason: `Same item as row ${first.line}, with no quantity to add` };
          out.item!.action = "skip";
        }
      } else if (skuOwner && skuOwner.nameKey !== item.nameKey) {
        out.status = "error";
        out.errors.push({ field: "sku", message: `SKU ${item.sku} is also given to another item in row ${skuOwner.line}` });
      } else {
        byName.set(item.nameKey, { line: row.line, sku: item.sku });
        if (item.sku) bySku.set(item.sku, { line: row.line, nameKey: item.nameKey });
      }
    }
    if (item.newCategory && out.item!.action === "create" && !options.createCategories && out.status !== "error") {
      out.status = "error";
      out.errors.push({ field: "category", message: `No category named ${item.newCategory}. Tick "Create the new categories" or add it on the Categories page.` });
    }
    const a = out.item!.action;
    if (out.status === "ready" && a !== "skip") {
      const earlier = out.dupKeys.map((k) => stock.get(k)).find((l) => l !== undefined);
      if (earlier !== undefined) {
        out.status = "duplicate";
        out.reason = `Same stock as row ${earlier} of this file (same item, day, quantity and price)`;
      }
    }
    if ((out.status === "ready" || out.status === "duplicate") && a !== "skip") {
      for (const k of out.dupKeys) if (!stock.has(k)) stock.set(k, row.line);
    }
    // A purchase always books its cost; a new item's opening stock only when booked as a purchase.
    out.amount = a === "purchase" ? item.cost : a === "create" && options.recordAsPurchases ? item.cost : 0;
    if (a === "create" && item.quantity > 0 && !options.recordAsPurchases) out.notes.quantity = "Stock on hand, no expense";
    else delete out.notes.quantity;
    return out;
  });
}

/** New categories the file would create, in file order. */
export function newCategories(rows: PreviewRow[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const c = r.item?.newCategory;
    if (c && r.item?.action === "create" && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()];
}

export type ReviewSummary = {
  ready: number;
  error: number;
  duplicate: number;
  skip: number;
  amount: number;
  creates: number;
  purchases: number;
  /** Rows to import that book money on a day before `monthStart`, so they change those months' totals. */
  earlier: number;
  /** Rows to import dated after `today`, often a typo in the year. */
  later: number;
};

/** Counts for the preview, and the money the rows to import record. */
export function summarize(rows: PreviewRow[], importDuplicates: boolean, monthStart = "", today = ""): ReviewSummary {
  const s: ReviewSummary = { ready: 0, error: 0, duplicate: 0, skip: 0, amount: 0, creates: 0, purchases: 0, earlier: 0, later: 0 };
  for (const r of rows) {
    s[r.status]++;
    if (willImport(r, importDuplicates)) {
      s.amount += r.amount;
      if (r.amount > 0 && r.date && monthStart && r.date < monthStart) s.earlier++;
      if (r.date && today && r.date > today) s.later++;
      if (r.item?.action === "create") s.creates++;
      if (r.item?.action === "purchase") s.purchases++;
    }
  }
  s.amount = Math.round(s.amount * 100) / 100;
  return s;
}

/** Ready rows, and duplicates when the admin chose to import them anyway. */
export function willImport(row: PreviewRow, importDuplicates: boolean): boolean {
  return row.status === "ready" || (importDuplicates && row.status === "duplicate");
}

/**
 * The rows that were not saved, as CSV: the file's own columns plus the row number and the reason,
 * so the admin can fix them and import that file again.
 */
export function notImportedCsv(
  headers: string[],
  sourceRows: { line: number; cells: string[] }[],
  reasons: Map<number, string>,
): string {
  const out: string[][] = [[...headers, "Row", "Reason"]];
  for (const r of sourceRows) {
    const reason = reasons.get(r.line);
    if (reason === undefined) continue;
    const cells = headers.map((_, i) => r.cells[i] ?? "");
    out.push([...cells, String(r.line), reason]);
  }
  return toCsv(out);
}

/** Why each row was not saved, from the review and the import results. */
export function notImportedReasons(
  reviewed: PreviewRow[],
  results: ImportRowResult[],
  importDuplicates: boolean,
  fieldLabel: (key: string) => string,
): Map<number, string> {
  const reasons = new Map<number, string>();
  for (const r of reviewed) {
    if (willImport(r, importDuplicates)) continue;
    if (r.status === "error") reasons.set(r.line, r.errors.map((e) => `${fieldLabel(e.field)}: ${e.message}`).join("; "));
    else reasons.set(r.line, r.reason ?? (r.status === "duplicate" ? "Looks like a record already saved" : "Nothing to add"));
  }
  for (const r of results) if (r.status !== "imported") reasons.set(r.line, r.message);
  return reasons;
}
