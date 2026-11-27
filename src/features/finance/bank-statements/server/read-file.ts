import "server-only";

import ExcelJS from "exceljs";
import { cellText } from "@/features/imports/csv/excel";
import { readRecords, readRecordsUpTo, type CsvDelimiter } from "@/features/imports/csv/parse";
import type { GridRow, ReadStatementResult, StatementFormat } from "../types";
import { autoMapping, detectBank, findHeaderRow } from "../parse/columns";
import { MAX_STATEMENT_LINES } from "../parse/statement";
import { StatementReadError } from "./errors";
import { readPdfStatement } from "./pdf";

/**
 * Reads an uploaded statement into rows of text cells and finds its column names. CSV and text
 * exports, Excel workbooks (.xlsx), the ".xls" files banks hand out (most are really an HTML table
 * or tab-separated text; a true old-format workbook is refused with a way out), and text PDFs.
 */

/** Rows read from one file: a year of a busy account, plus the lines around the table. */
const MAX_ROWS = MAX_STATEMENT_LINES + 200;
const MAX_COLUMNS = 40;

const isBlank = (r: GridRow) => r.cells.every((c) => c.trim() === "");

/**
 * The rows with text. A row right after a blank row is marked `near: false`, and so is a workbook
 * row after a gap in the row numbers (`lineGaps`; a CSV record's line jumps after a quoted line
 * break, so it is not used there): a note under the table is never a narration's wrapped text.
 */
function nonEmpty(rows: GridRow[], lineGaps = false): GridRow[] {
  const out: GridRow[] = [];
  let gap = false;
  for (const r of rows) {
    if (isBlank(r)) {
      gap = true;
      continue;
    }
    const prev = out[out.length - 1];
    const apart = gap || (lineGaps && prev !== undefined && r.line > prev.line + 1);
    out.push(apart && prev !== undefined ? { ...r, near: false } : r);
    gap = false;
  }
  return out;
}

function decode(bytes: Buffer): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  // Some banks still export Windows-1252; a run of replacement characters means it was not UTF-8.
  if ((utf8.match(/�/g)?.length ?? 0) > 3) return new TextDecoder("windows-1252").decode(bytes);
  return utf8;
}

/** The separator that splits most of the first lines into four or more cells (bank CSVs start with a few account lines). */
function pickDelimiter(text: string): CsvDelimiter {
  // The first 60 lines, found without splitting the whole file into lines.
  let end = -1;
  for (let n = 0; n < 60; n++) {
    end = text.indexOf("\n", end + 1);
    if (end < 0) break;
  }
  const head = end < 0 ? text : text.slice(0, end > 0 && text[end - 1] === "\r" ? end - 1 : end);
  const sample = head.replace(/\r\n/g, "\n");
  let best: CsvDelimiter = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t"] as CsvDelimiter[]) {
    const score = readRecords(sample, d).filter((r) => r.cells.length >= 4).length;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function readText(text: string): GridRow[] {
  const { records, total } = readRecordsUpTo(text, pickDelimiter(text), MAX_ROWS);
  if (total > MAX_ROWS) throw tooLong(total);
  // Cells keep the spaces the bank wrote around them: a narration cut at a fixed width is joined
  // back by them (see joinHardCuts in parse/statement.ts). The reader trims every cell it reads.
  return nonEmpty(records.map((r) => ({ line: r.line, cells: r.cells.slice(0, MAX_COLUMNS) })));
}

const tooLong = (n: number) =>
  new StatementReadError(`This file has ${n.toLocaleString("en-IN")} rows. Upload at most ${MAX_STATEMENT_LINES.toLocaleString("en-IN")} lines at a time: download a shorter period.`);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function htmlText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** An HTML table saved with an .xls name (what several banks' "Excel" download is). */
function readHtmlTable(html: string): GridRow[] {
  const rows: GridRow[] = [];
  const rowRe = /<tr[\s>][\s\S]*?<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const cells = [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlText(c[1] ?? "")).slice(0, MAX_COLUMNS);
    rows.push({ line: rows.length + 1, cells });
    if (rows.length > MAX_ROWS) throw tooLong(rows.length);
  }
  return nonEmpty(rows);
}

async function readXlsx(bytes: Buffer): Promise<{ grid: GridRow[]; sheet: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new StatementReadError("This Excel file could not be opened. Save it again as an Excel workbook (.xlsx) or as CSV and upload that file.");
  }
  const sheets = workbook.worksheets.filter((ws) => ws.state === "visible" && ws.actualRowCount > 0);
  let fallback: { grid: GridRow[]; sheet: string } | null = null;
  for (const ws of sheets) {
    if (ws.actualRowCount > MAX_ROWS) throw tooLong(ws.actualRowCount);
    const grid: GridRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (c, col) => {
        if (col > MAX_COLUMNS) return;
        // As written, line breaks and spaces at the ends included (see readText).
        cells[col - 1] = cellText(c.value, c.address);
      });
      for (let i = 0; i < cells.length; i++) cells[i] ??= "";
      grid.push({ line: rowNumber, cells });
    });
    const rows = nonEmpty(grid, true);
    if (findHeaderRow(rows) >= 0) return { grid: rows, sheet: ws.name };
    fallback ??= { grid: rows, sheet: ws.name };
  }
  if (!fallback) throw new StatementReadError("This workbook has no rows.");
  return fallback;
}

export function formatOf(name: string): StatementFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === "csv" || ext === "txt") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "pdf") return "pdf";
  return null;
}

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

/**
 * Reads the file and finds its columns. Throws StatementReadError with a message for the admin
 * (PdfPasswordError for a locked PDF). `options.password` opens a locked PDF and is used for nothing else.
 */
export async function readStatementFile(bytes: Buffer, fileName: string, options?: { password?: string }): Promise<ReadStatementResult> {
  const format = formatOf(fileName);
  if (!format) throw new StatementReadError("Upload the statement as CSV, Excel (.xlsx or .xls) or PDF.");
  const notes: string[] = [];
  let grid: GridRow[];
  let headerIndex: number | null = null;
  let sheet: string | undefined;

  if (format === "pdf") {
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new StatementReadError("This file is not a PDF. Check that you picked the right file.");
    ({ grid, headerIndex } = await readPdfStatement(bytes, options?.password));
    if (headerIndex < 0) {
      throw new StatementReadError(
        "The table of transactions was not found in this PDF (no row with a date, narration and amount columns). Download the statement as CSV or Excel and upload that.",
      );
    }
  } else if (format === "xlsx") {
    ({ grid, sheet } = await readXlsx(bytes));
  } else if (format === "xls") {
    if (OLE_SIGNATURE.every((b, i) => bytes[i] === b)) {
      throw new StatementReadError(
        "This is an old-format Excel file (.xls), which cannot be read here. Open it in Excel and save it as an Excel workbook (.xlsx) or CSV, or download the statement as CSV, and upload that.",
      );
    }
    // Zipped .xlsx content under an .xls name.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) ({ grid, sheet } = await readXlsx(bytes));
    else {
      const text = decode(bytes);
      grid = /<table[\s>]/i.test(text) ? readHtmlTable(text) : readText(text);
    }
  } else {
    grid = readText(decode(bytes));
  }

  if (!grid.length) throw new StatementReadError("This file is empty.");
  const found = headerIndex ?? findHeaderRow(grid);
  if (found < 0) notes.push("The column names were not found. Pick the row that holds them, then the columns.");
  const header = found >= 0 ? grid[found]!.cells : [];
  return {
    fileName,
    format,
    grid,
    headerIndex: found,
    mapping: autoMapping(header),
    bank: detectBank(grid, found),
    sheet,
    notes,
  };
}
