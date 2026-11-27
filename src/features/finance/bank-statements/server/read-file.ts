import "server-only";

import ExcelJS from "exceljs";
// The zip reader ExcelJS itself opens workbooks with (it is ExcelJS's dependency).
import JSZip from "jszip";
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

/** `s` without its tags: what `s.replace(/<[^>]*>/g, "")` gives, without rescanning the rest of `s` for every unclosed "<". */
function stripTags(s: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const lt = s.indexOf("<", pos);
    if (lt < 0) break;
    const gt = s.indexOf(">", lt + 1);
    // No ">" after this "<", so none after a later "<" either: the rest is text.
    if (gt < 0) break;
    out += s.slice(pos, lt);
    pos = gt + 1;
  }
  return out + s.slice(pos);
}

function htmlText(s: string): string {
  return stripTags(s.replace(/<br\s*\/?>/gi, " "))
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

/**
 * `s` with A to Z lowered and nothing else changed, so an index in it is the same index in `s`
 * (toLowerCase can change the length, "İ" becomes two characters). Case-insensitive regexes
 * match ASCII letters only in the same way.
 */
const asciiLower = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/**
 * The cells of one row: the text of what `/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi` matches, at most
 * MAX_COLUMNS of them, found in one pass. `lower` is asciiLower(row).
 */
function htmlCells(row: string, lower: string): string[] {
  const cells: string[] = [];
  let pos = 0;
  while (cells.length < MAX_COLUMNS) {
    const open = lower.indexOf("<t", pos);
    if (open < 0) break;
    const kind = lower[open + 2];
    if (kind !== "d" && kind !== "h") {
      pos = open + 1;
      continue;
    }
    const gt = lower.indexOf(">", open + 3);
    // Without a ">" (or, below, a closing tag) after this cell's start, no later cell can match either.
    if (gt < 0) break;
    let close = lower.indexOf("</t", gt + 1);
    while (close >= 0 && !((lower[close + 3] === "d" || lower[close + 3] === "h") && lower[close + 4] === ">")) close = lower.indexOf("</t", close + 1);
    if (close < 0) break;
    cells.push(htmlText(row.slice(gt + 1, close)));
    pos = close + 5;
  }
  return cells;
}

/**
 * An HTML table saved with an .xls name (what several banks' "Excel" download is). The rows are
 * what `/<tr[\s>][\s\S]*?<\/tr>/gi` matches, found with indexOf so the work grows with the file's
 * size (the regex scanned to the end of the file again for every unclosed "<tr").
 */
function readHtmlTable(html: string): GridRow[] {
  const lower = asciiLower(html);
  const rows: GridRow[] = [];
  let pos = 0;
  for (;;) {
    const start = lower.indexOf("<tr", pos);
    if (start < 0) break;
    const next = lower[start + 3];
    if (next === undefined || (next !== ">" && !/\s/.test(next))) {
      pos = start + 1;
      continue;
    }
    const end = lower.indexOf("</tr>", start + 4);
    // No "</tr>" after this row's start, so no later row is closed either.
    if (end < 0) break;
    rows.push({ line: rows.length + 1, cells: htmlCells(html.slice(start, end + 5), lower.slice(start, end + 5)) });
    if (rows.length > MAX_ROWS) throw tooLong(rows.length);
    pos = end + 5;
  }
  return nonEmpty(rows);
}

const cannotOpenWorkbook = () =>
  new StatementReadError("This Excel file could not be opened. Save it again as an Excel workbook (.xlsx) or as CSV and upload that file.");

/*
 * What a workbook may unpack to. ExcelJS unzips every part into memory and builds the whole sheet
 * before the row limit can be checked, so a 60 KB zip of a million tiny rows took 1.2 GB. A year
 * of statement lines (3,150 rows) written by ExcelJS unpacks to 1.2 MB and 54,000 tags with 7
 * columns, and to 5.3 MB and 268,000 tags with 40 columns, the most this reader keeps.
 */
const MAX_XLSX_PARTS = 1000;
const MAX_XLSX_BYTES = 32 * 1024 * 1024;
/** XML elements in all parts together (a cell is two or three: <c>, <v>, and <is><t> for inline text). */
const MAX_XLSX_TAGS = 500_000;

/**
 * Unzips the workbook once, counting bytes and XML start tags as they come out and stopping at the
 * limits, before ExcelJS reads it. The sizes the zip declares are not trusted.
 */
async function checkWorkbookSize(bytes: Buffer): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw cannotOpenWorkbook();
  }
  const tooBig = () =>
    new StatementReadError("This Excel file holds far more than a bank statement does, so it was not read. Download a shorter period, or save the sheet as CSV, and upload that.");
  const parts = Object.values(zip.files).filter((f) => !f.dir);
  if (parts.length > MAX_XLSX_PARTS) throw tooBig();
  let bytesLeft = MAX_XLSX_BYTES;
  let tagsLeft = MAX_XLSX_TAGS;
  for (const part of parts) {
    const xml = /\.(xml|rels)$/i.test(part.name);
    let afterLt = false;
    try {
      await unzipPart(part, (chunk) => {
        bytesLeft -= chunk.length;
        if (bytesLeft < 0) throw tooBig();
        if (!xml) return;
        for (let i = 0; i < chunk.length; i++) {
          const b = chunk[i]!;
          // "<" and a letter starts an element; "</", "<?" and "<!" do not.
          if (afterLt && ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a))) tagsLeft--;
          afterLt = b === 0x3c;
        }
        if (tagsLeft < 0) throw tooBig();
      });
    } catch (error) {
      if (error instanceof StatementReadError) throw error;
      throw cannotOpenWorkbook();
    }
  }
}

/** Unzips one part chunk by chunk. When `onChunk` throws, unzipping stops and the promise rejects with that error. */
function unzipPart(part: JSZip.JSZipObject, onChunk: (chunk: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = part.nodeStream("nodebuffer");
    stream.on("data", (chunk: Buffer) => {
      try {
        onChunk(chunk);
      } catch (error) {
        stream.pause();
        stream.removeAllListeners("data");
        reject(error);
      }
    });
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
}

async function readXlsx(bytes: Buffer): Promise<{ grid: GridRow[]; sheet: string }> {
  await checkWorkbookSize(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw cannotOpenWorkbook();
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
