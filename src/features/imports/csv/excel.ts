import "server-only";

import ExcelJS from "exceljs";
import { CSV_IMPORT_KINDS, KIND_LABELS, MAX_CSV_ROWS, autoMapColumns, templateRows, type CsvImportKind } from "./fields";
import type { ParsedCsv } from "./parse";

/**
 * Reads an Excel workbook (.xlsx) into the same header-and-rows shape the CSV import uses, so the
 * column matching, checks and import after it are identical for both formats.
 */

export type ParsedSheet = Pick<ParsedCsv, "headers" | "rows"> & { sheets: string[]; sheet: string };

export class ExcelReadError extends Error {}

/** Import sheets have a few dozen columns at most; a stray cell far to the right must not widen every row. */
const MAX_COLUMNS = 100;
/** The row limit plus room for title and note rows. Bigger sheets are refused before they are read. */
const MAX_SHEET_ROWS = MAX_CSV_ROWS + 50;
/** The column names are looked for in the first rows only. */
const HEADER_SEARCH_ROWS = 30;

type CellLike = { value: ExcelJS.CellValue; address: string; isMerged?: boolean; master?: unknown };

/** One cell as the CSV path would have it: dates as YYYY-MM-DD, numbers plain, formulas as their result. */
export function cellText(value: ExcelJS.CellValue, address = "?"): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Excel stores dates without a time zone; ExcelJS returns them as UTC midnight.
    if (Number.isNaN(value.getTime())) return "";
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // 0.1 + 0.2 style float noise from formulas: keep at most 10 decimals, no exponent for big numbers.
    const rounded = Number(value.toFixed(10));
    return Math.abs(rounded) >= 1e21 ? rounded.toLocaleString("en-US", { useGrouping: false }) : String(rounded);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text ?? "").join("");
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      // A workbook written by a script and never opened in Excel has formulas but no values.
      if (result === undefined) {
        throw new ExcelReadError(`Cell ${address} has a formula without a calculated value. Open the file in Excel, save it again, and pick it.`);
      }
      return cellText(result, address);
    }
    if ("hyperlink" in value) return cellText((value as { text?: ExcelJS.CellValue }).text ?? "", address);
    // "#REF!", "#DIV/0!": kept as text so an amount column reports "Not an amount" instead of reading 0.
    if ("error" in value) return String((value as { error?: string }).error ?? "#ERROR!");
  }
  return String(value);
}

type SheetRecord = { line: number; cells: string[]; distinct: number };

/** The non-empty rows of a sheet, at most MAX_COLUMNS wide, with how many distinct values each holds. */
function sheetRecords(ws: ExcelJS.Worksheet): SheetRecord[] {
  if (ws.actualRowCount > MAX_SHEET_ROWS) {
    throw new ExcelReadError(
      `The sheet "${ws.name}" has ${ws.actualRowCount.toLocaleString("en-IN")} rows. Import at most ${MAX_CSV_ROWS.toLocaleString("en-IN")} at a time; split it into smaller files.`,
    );
  }
  const records: SheetRecord[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    const values = new Set<string>();
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (col > MAX_COLUMNS) return;
      const c = cell as unknown as CellLike;
      const text = cellText(c.value, c.address).replace(/\r\n?/g, "\n").trim();
      cells[col - 1] = text;
      // A title merged across columns repeats in every merged cell: count it once.
      const repeat = c.isMerged && c.master !== cell;
      if (text && !repeat) values.add(text);
    });
    for (let i = 0; i < cells.length; i++) cells[i] ??= "";
    if (cells.some((t) => t !== "")) records.push({ line: rowNumber, cells, distinct: values.size });
  });
  return records;
}

/**
 * Which row holds the column names: the first that matches at least two of the import's column
 * names, else the first with two different values (skipping a title row), else the first row.
 */
function headerIndex(records: SheetRecord[], kind: CsvImportKind | null): { index: number; matched: number } {
  const limit = Math.min(records.length, HEADER_SEARCH_ROWS);
  if (kind) {
    for (let i = 0; i < limit; i++) {
      const matched = autoMapColumns(kind, records[i]!.cells).filter(Boolean).length;
      if (matched >= 2) return { index: i, matched };
    }
  }
  for (let i = 0; i < limit; i++) if (records[i]!.distinct >= 2) return { index: i, matched: 0 };
  return { index: 0, matched: 0 };
}

function toParsed(records: SheetRecord[], index: number): Pick<ParsedCsv, "headers" | "rows"> {
  const headers = (records[index]?.cells ?? []).map((h) => h.trim());
  // Empty header cells at the end (formatting past the last column) are not columns.
  while (headers.length && headers[headers.length - 1] === "") headers.pop();
  const width = Math.max(headers.length, 1);
  return {
    headers,
    rows: records.slice(index + 1).map((r) => ({ line: r.line, cells: Array.from({ length: width }, (_, i) => r.cells[i] ?? "") })),
  };
}

/**
 * Reads the chosen sheet, or picks one: the first whose column names match the import (so an
 * "Instructions" sheet in front is passed over), else the first visible sheet with data.
 */
export async function readWorkbook(bytes: Buffer, sheetName?: string | null, kind: CsvImportKind | null = null): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ExcelReadError("This Excel file could not be opened. Save it again as an Excel workbook (.xlsx) or as CSV and pick that file.");
  }
  const sheets = workbook.worksheets.filter((ws) => ws.state !== "veryHidden");
  if (!sheets.length) throw new ExcelReadError("This workbook has no sheets.");
  const names = sheets.map((ws) => ws.name);

  if (sheetName) {
    const ws = sheets.find((s) => s.name === sheetName);
    if (!ws) throw new ExcelReadError(`There is no sheet named "${sheetName}" in this workbook.`);
    const records = sheetRecords(ws);
    return { ...toParsed(records, headerIndex(records, kind).index), sheets: names, sheet: ws.name };
  }

  let fallback: { ws: ExcelJS.Worksheet; records: SheetRecord[]; index: number } | null = null;
  for (const ws of sheets.filter((s) => s.state !== "hidden" && s.actualRowCount > 0)) {
    const records = sheetRecords(ws);
    if (!records.length) continue;
    const { index, matched } = headerIndex(records, kind);
    if (matched >= 2) return { ...toParsed(records, index), sheets: names, sheet: ws.name };
    fallback ??= { ws, records, index };
  }
  if (fallback) return { ...toParsed(fallback.records, fallback.index), sheets: names, sheet: fallback.ws.name };
  return { headers: [], rows: [], sheets: names, sheet: sheets[0]!.name };
}

/** The import template as an Excel workbook: the column names and one example row. */
export async function templateWorkbook(kind: CsvImportKind): Promise<Buffer> {
  if (!(CSV_IMPORT_KINDS as readonly string[]).includes(kind)) throw new ExcelReadError("Unknown template.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Biios Project Manager";
  const ws = workbook.addWorksheet(KIND_LABELS[kind].title);
  const [header, example] = templateRows(kind);
  ws.addRow(header);
  // Text cells, so Excel keeps what the example shows (dates, GSTINs, leading zeros) as written.
  ws.addRow(example);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  header!.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(String(h).length, String(example?.[i] ?? "").length) + 4, 40);
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
