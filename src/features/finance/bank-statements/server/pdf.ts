import "server-only";

import type { GridRow } from "../types";
import { headerScore, roleOf } from "../parse/columns";
import { StatementReadError } from "./errors";

/**
 * Rebuilds the table of a text PDF statement from where each piece of text sits on the page.
 * Text on one baseline is a row; the column names give each column's left and right edge, and
 * every piece of text goes to the column its middle falls in. Pages that repeat the column names
 * set the columns again, so a page laid out a little differently still reads right.
 */

type Word = { x1: number; x2: number; y: number; size: number; text: string };
type PdfLine = { page: number; y: number; size: number; words: Word[] };
type Column = { x1: number; x2: number };

/** Statements longer than this are refused rather than read for a minute. */
const MAX_PAGES = 150;
/** A scanned page has no text; fewer characters than this in the whole file means a scan. */
const MIN_TEXT = 40;

function toLines(page: number, words: Word[]): PdfLine[] {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x1 - b.x1);
  const lines: PdfLine[] = [];
  for (const w of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - w.y) <= Math.max(2, Math.min(line.size, w.size) * 0.45)) line.words.push(w);
    else lines.push({ page, y: w.y, size: w.size, words: [w] });
  }
  for (const l of lines) l.words.sort((a, b) => a.x1 - b.x1);
  return lines;
}

/** Words close together on a line (one space apart or less) are one phrase: a column name, a narration. */
function phrases(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.x1 - last.x2 <= Math.max(1.5, w.size * 0.6)) {
      last.x2 = Math.max(last.x2, w.x2);
      last.text = `${last.text} ${w.text}`;
    } else out.push({ ...w });
  }
  return out;
}

/** A piece of text cut at character `at`, its width shared out by character count. */
function cutAt(w: Word, at: number): [Word, Word] {
  const mid = w.x1 + ((w.x2 - w.x1) * at) / w.text.length;
  return [
    { ...w, x2: mid, text: w.text.slice(0, at).trim() },
    { ...w, x1: mid, text: w.text.slice(at).trim() },
  ];
}

/**
 * Two column names the PDF reader joined into one piece because they sit close together
 * ("Deposit Amt.Closing Balance"): cut where both halves name a column and the whole does not
 * name a single one by itself.
 */
function splitJoinedNames(w: Word): Word[] {
  const role = roleOf(w.text);
  for (let at = 2; at < w.text.length - 1; at++) {
    const left = w.text.slice(0, at);
    const right = w.text.slice(at);
    // Cut only where a new word starts: after a space or full stop, or at a capital after a small letter.
    if (!/[\s.)]$/.test(left) && !(/[a-z]$/.test(left) && /^[A-Z]/.test(right))) continue;
    // "Withdrawal Amt." and "Balance (INR)" are one name each: a half may not start with the amount's unit.
    if (/^\s*(amt\b|amount\b|\(?\s*inr\b|rs\b|in rs\b)/i.test(right)) continue;
    const a = roleOf(left);
    const b = roleOf(right);
    if (a && b && a !== b && (role === a || role === b || role === null)) {
      const [l, r] = cutAt(w, at);
      return [...splitJoinedNames(l), ...splitJoinedNames(r)];
    }
  }
  return [w];
}

const AMOUNT_PIECE = /-?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}(?:\s?(?:Cr|Dr|CR|DR))?/g;

/** Amounts of neighbouring columns joined into one piece ("2,50,000.004,74,900.00") are cut apart. */
function splitJoinedAmounts(w: Word): Word[] {
  const text = w.text.replace(/\s+/g, " ").trim();
  const pieces = text.match(AMOUNT_PIECE) ?? [];
  if (pieces.length < 2 || pieces.join("").replace(/\s/g, "") !== text.replace(/\s/g, "")) return [w];
  const out: Word[] = [];
  let rest = { ...w, text };
  for (const p of pieces.slice(0, -1)) {
    const [l, r] = cutAt(rest, rest.text.indexOf(p) + p.length);
    out.push(l);
    rest = r;
  }
  out.push(rest);
  return out;
}

/** Column names that wrap onto a second line ("Withdrawal" / "Amt.") are joined under the phrase they overlap. */
function mergeHeader(first: Word[], second: Word[]): Word[] {
  const merged = first.map((w) => ({ ...w }));
  for (const s of second) {
    const target = merged.find((m) => s.x1 < m.x2 + 2 && s.x2 > m.x1 - 2);
    if (target) {
      target.text = `${target.text} ${s.text}`;
      target.x1 = Math.min(target.x1, s.x1);
      target.x2 = Math.max(target.x2, s.x2);
    } else merged.push({ ...s });
  }
  return merged.sort((a, b) => a.x1 - b.x1);
}

/** The column names on this line (or on it and the next), when they are enough to read a statement. */
function headerAt(lines: PdfLine[], i: number): { cells: Word[]; span: number } | null {
  const line = lines[i]!;
  const next = lines[i + 1];
  const wraps = Boolean(next && next.page === line.page && line.y - next.y <= line.size * 2.2);
  let best: { cells: Word[]; span: number; score: number } | null = null;
  // Column names set close together can join into one phrase ("Deposit Amt. Closing Balance"), so
  // each piece of text on its own is tried too; the reading that names more columns wins.
  for (const one of [phrases(line.words), line.words.map((w) => ({ ...w })), line.words.flatMap(splitJoinedNames)]) {
    const a = headerScore(one.map((w) => w.text));
    if (a.usable && (!best || a.score > best.score)) best = { cells: one, span: 1, score: a.score };
    if (!wraps) continue;
    const two = mergeHeader(one, phrases(next!.words));
    const b = headerScore(two.map((w) => w.text));
    if (b.usable && b.score > a.score && (!best || b.score > best.score)) best = { cells: two, span: 2, score: b.score };
  }
  return best ? { cells: best.cells, span: best.span } : null;
}

/** Cuts a line into the header's columns: each word goes where its middle is. */
function cellsOf(line: PdfLine, columns: Column[]): string[] {
  const cells = columns.map(() => [] as string[]);
  const bounds = columns.map((c, i) => (i < columns.length - 1 ? (c.x2 + columns[i + 1]!.x1) / 2 : Infinity));
  for (const w of line.words) {
    const mid = (w.x1 + w.x2) / 2;
    const col = bounds.findIndex((b) => mid < b);
    cells[col === -1 ? columns.length - 1 : col]!.push(w.text);
  }
  return cells.map((c) => c.join(" ").replace(/\s+/g, " ").trim());
}

type TextItem = { str: string; x: number; y: number; width: number; fontSize: number; height: number };

/** Reads a text PDF into rows of cells, the column names first. */
export async function readPdfStatement(bytes: Buffer): Promise<{ grid: GridRow[]; headerIndex: number }> {
  const { getDocumentProxy, extractTextItems } = await import("unpdf");
  let pages: TextItem[][];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PAGES) {
      throw new StatementReadError(`This PDF has ${pdf.numPages} pages. Upload at most ${MAX_PAGES} pages at a time, or download the statement as CSV or Excel.`);
    }
    pages = (await extractTextItems(pdf)).items as TextItem[][];
  } catch (error) {
    if (error instanceof StatementReadError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      throw new StatementReadError(
        "This PDF is password protected. Banks often lock statements with your customer ID or date of birth. Open it, save or print a copy without the password, and upload that copy.",
      );
    }
    throw new StatementReadError("This PDF could not be opened. Download the statement again, or as CSV or Excel, and upload that file.");
  }

  const text = pages.flat().map((t) => t.str).join("");
  if (text.replace(/\s/g, "").length < MIN_TEXT) {
    throw new StatementReadError(
      "This PDF has no text in it: it looks like a scanned or photographed statement. Reading scans is not reliable enough for bank figures. Download the statement from net banking as CSV, Excel or a PDF with text, and upload that.",
    );
  }

  const lines: PdfLine[] = [];
  pages.forEach((items, p) => {
    const words: Word[] = items
      .filter((t) => t.str && t.str.trim())
      .map((t) => {
        const size = t.fontSize || t.height || 8;
        return { x1: t.x, x2: t.x + (t.width || t.str.length * size * 0.5), y: t.y, size, text: t.str.trim() };
      });
    lines.push(...toLines(p + 1, words));
  });

  const grid: GridRow[] = [];
  let headerIndex = -1;
  let columns: Column[] | null = null;
  let prev: PdfLine | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const header = headerAt(lines, i);
    if (header) {
      columns = header.cells.map((c) => ({ x1: c.x1, x2: c.x2 }));
      // The first header is the grid's; later repeats are dropped (the statement reader skips them anyway).
      if (headerIndex === -1) {
        headerIndex = grid.length;
        grid.push({ line: grid.length + 1, page: line.page, cells: header.cells.map((c) => c.text) });
      }
      i += header.span - 1;
      prev = lines[i]!;
      continue;
    }
    if (!columns) {
      // Lines above the table: the account details. Kept as one cell each, for the bank's name.
      grid.push({ line: grid.length + 1, page: line.page, cells: [phrases(line.words).map((w) => w.text).join("  ")] });
      prev = line;
      continue;
    }
    const near = Boolean(prev && prev.page === line.page && prev.y - line.y <= Math.max(prev.size, line.size) * 2.4);
    grid.push({ line: grid.length + 1, page: line.page, near, cells: cellsOf({ ...line, words: line.words.flatMap(splitJoinedAmounts) }, columns) });
    prev = line;
  }
  return { grid, headerIndex };
}
