/**
 * A small CSV reader and writer. Client-safe and pure.
 *
 * Reads what spreadsheets export: UTF-8 with or without a byte order mark, comma, semicolon or tab
 * separated, fields in double quotes that hold separators, doubled quotes ("") and line breaks,
 * Windows or Unix line endings, and blank lines (skipped).
 */

export type CsvDelimiter = "," | ";" | "\t";

export type ParsedCsv = {
  delimiter: CsvDelimiter;
  /** The first non-blank line, trimmed. */
  headers: string[];
  /** The data rows, each with its line number in the file (1 is the header line). */
  rows: { line: number; cells: string[] }[];
};

/** Guesses the separator from the first line, ignoring anything inside quotes. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/** Splits CSV text into records of fields. Each record keeps the line it started on. */
export function readRecords(input: string, delimiter: CsvDelimiter): { line: number; cells: string[] }[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let i = 0;
  const endRecord = () => {
    cells.push(field);
    records.push({ line: startLine, cells });
    cells = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      // A quote opens a quoted field only at its start (spaces before it are dropped).
      field = "";
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      line++;
      startLine = line;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || cells.length > 0) endRecord();
  return records;
}

const isBlank = (cells: string[]) => cells.every((c) => c.trim() === "");

/** Parses a whole file: header row first, blank lines dropped, cells trimmed. */
export function parseCsv(text: string): ParsedCsv {
  const delimiter = detectDelimiter(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const records = readRecords(text, delimiter).filter((r) => !isBlank(r.cells));
  const [head, ...rest] = records;
  const headers = (head?.cells ?? []).map((h) => h.trim());
  // Trailing empty header cells (a stray separator at the end of the line) are not columns.
  while (headers.length && headers[headers.length - 1] === "") headers.pop();
  return {
    delimiter,
    headers,
    rows: rest.map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) })),
  };
}

/** One CSV field, quoted when it holds a separator, a quote, a line break or edge spaces. */
export function csvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",;\r\n\t]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Rows to CSV text, comma separated with Windows line endings and a byte order mark, so Excel
 * opens it as UTF-8 (₹ and other non-English letters stay readable).
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
