import "server-only";

import type { ColumnRole, GridRow } from "../types";
import { autoMapping, headerScore, roleOf } from "../parse/columns";
import { readAmount, readDate } from "../parse/values";
import { StatementReadError } from "./errors";

/**
 * Rebuilds the table of a text PDF statement from where each piece of text sits on the page.
 * Text on one baseline is a row. The column names say which columns there are; where one column
 * ends and the next starts is read from the rows themselves, because banks set the names left,
 * right or centred over right-aligned amounts:
 *
 * - the amounts of one column overlap each other on the page, so each money column is the band
 *   its amounts cover, matched in order to the money columns' names;
 * - every other edge is the quietest place between two names that no text of the rows crosses.
 *
 * A piece of text that the PDF reader ran across two columns (a narration that fills its cell,
 * glued to the cheque number) is cut where the next column starts, when both halves read as what
 * their columns hold. Only rows of the table reach the grid: the bank's page header above the
 * repeated column names, page numbers and footers are left out, and a text-only row joins the
 * line above it only while the rows above it are the table's.
 */

type Word = { x1: number; x2: number; y: number; size: number; text: string; piece?: number };
type PdfLine = { page: number; y: number; size: number; words: Word[] };

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

/**
 * A line under the column names that only finishes them ("No.", "Amt.", "(Cr)", "Balance"): no
 * digits, and every piece under a name other than the narration's. A row of the table never
 * passes: it has a date or an amount, and a wrapped narration sits under the narration.
 */
function finishesHeader(cells: Word[], next: Word[]): boolean {
  return (
    next.length > 0 &&
    next.every((s) => {
      if (/\d/.test(s.text)) return false;
      const target = cells.find((m) => s.x1 < m.x2 + 2 && s.x2 > m.x1 - 2);
      return Boolean(target) && roleOf(target!.text) !== "narration";
    })
  );
}

const wrapsOnto = (line: PdfLine, next: PdfLine | undefined): next is PdfLine => Boolean(next && next.page === line.page && line.y - next.y <= line.size * 2.2);

/** The column names on this line (or on it and the next one or two), when they are enough to read a statement. */
function headerAt(lines: PdfLine[], i: number): { cells: Word[]; span: number } | null {
  const line = lines[i]!;
  const next = lines[i + 1];
  const third = lines[i + 2];
  let best: { cells: Word[]; span: number; score: number } | null = null;
  // Column names set close together can join into one phrase ("Deposit Amt. Closing Balance"), so
  // each piece of text on its own is tried too; the reading that names more columns wins. Names cut
  // from one piece remember it (`piece`), so the columns can join them again when the rows show one column.
  const readings = [phrases(line.words), line.words.map((w) => ({ ...w })), line.words.flatMap((w, k) => splitJoinedNames(w).map((p) => ({ ...p, piece: k })))];
  for (const one of readings) {
    const a = headerScore(one.map((w) => w.text));
    let found = a.usable ? { cells: one, span: 1, score: a.score } : null;
    if (wrapsOnto(line, next)) {
      const second = phrases(next.words);
      const two = mergeHeader(one, second);
      const b = headerScore(two.map((w) => w.text));
      // The second line names more columns, or only finishes the names of the first ("Ref No./Cheque" / "No.").
      if (b.usable && (b.score > a.score || (a.usable && b.score === a.score && finishesHeader(one, second)))) {
        found = { cells: two, span: 2, score: b.score };
        if (wrapsOnto(next, third)) {
          const last = phrases(third.words);
          const three = mergeHeader(two, last);
          const c = headerScore(three.map((w) => w.text));
          if (c.usable && c.score >= b.score && finishesHeader(two, last)) found = { cells: three, span: 3, score: c.score };
        }
      }
    }
    if (found && (!best || found.score > best.score)) best = found;
  }
  return best ? { cells: best.cells, span: best.span } : null;
}

// ---- Columns from the rows ----

const MONEY_ROLES: ReadonlySet<ColumnRole> = new Set(["withdrawal", "deposit", "amount", "balance"]);
/** A piece that is one amount and nothing else: "1,23,456.78", "-500.00", "(500.00)", "31,445.55(Dr)", "500.00 Cr". */
const AMOUNT_ONLY = /^[(-]?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\)?-?(?:\s?\(?(?:Cr|Dr|CR|DR)\.?\)?)?$/;
const MARKED = /(?:Cr|Dr|CR|DR)\.?\)?$/;
const DATE_LIKE = /\d{1,4}[/\-. ]+[A-Za-z0-9]{1,9}[/\-. ]+\d{2,4}/;
const PAGE_NUMBER = /^(page|pg\.?)\s*(no\.?)?\s*[:.]?\s*\d+(\s*(of|\/)\s*\d+)?$/i;

const isDateText = (s: string) => s.length <= 24 && DATE_LIKE.test(s) && readDate(s) !== null;

/** A row of transactions: a piece of it (or its first two or three words together) is a date. */
function isDated(words: Word[]): boolean {
  if (words.some((w) => isDateText(w.text))) return true;
  for (let n = 2; n <= 3 && n <= words.length; n++) {
    if (isDateText(words.slice(0, n).map((w) => w.text).join(" "))) return true;
  }
  return false;
}

/** Helvetica's character widths (thousandths of the font size) for " " to "~", to find a character's place in a piece. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722,
  722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Where each character of a piece starts on the page (and, last, where the piece ends). */
function charEdges(w: Word): number[] {
  const widths = w.text.split("").map((c) => WIDTHS[c.charCodeAt(0) - 32] ?? 556);
  const total = widths.reduce((s, x) => s + x, 0) || 1;
  const scale = (w.x2 - w.x1) / total;
  const edges = [w.x1];
  for (const x of widths) edges.push(edges[edges.length - 1]! + x * scale);
  return edges;
}

type Band = { x1: number; x2: number; n: number; marked: number; col: number };

type Layout = {
  /** The column names; two halves of one cut name are joined again when the rows show one column under both. */
  header: Word[];
  roles: (ColumnRole | null)[];
  /** What the statement reader will take each column for. */
  mapping: (ColumnRole | null)[];
  /** bounds[k]: where column k ends and column k + 1 starts. */
  bounds: number[];
  /** Where the amounts of each money column sit. */
  bands: Band[];
  /** Where the text of a text column starts on most rows. */
  starts: (number | null)[];
  /** False when the rows gave nothing to go by: the names' positions alone, as before. */
  fromBody: boolean;
};

/** The amounts of one column overlap each other; amounts of two columns do not. Null when a band holds two amounts of one row. */
function bandsOf(amounts: { w: Word; row: number }[]): Omit<Band, "col">[] | null {
  const sorted = [...amounts].sort((a, b) => a.w.x1 - b.w.x1);
  const out: (Omit<Band, "col"> & { rows: Set<number> })[] = [];
  for (const { w, row } of sorted) {
    const last = out[out.length - 1];
    const marked = MARKED.test(w.text) ? 1 : 0;
    if (last && w.x1 < last.x2 - 0.2) {
      if (last.rows.has(row)) return null;
      last.rows.add(row);
      last.x2 = Math.max(last.x2, w.x2);
      last.n++;
      last.marked += marked;
    } else out.push({ x1: w.x1, x2: w.x2, n: 1, marked, rows: new Set([row]) });
  }
  return out.map(({ x1, x2, n, marked }) => ({ x1, x2, n, marked }));
}

const overlap = (a: { x1: number; x2: number }, b: { x1: number; x2: number }) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);

/**
 * Gives the bands, left to right, to the money columns, left to right: as many as can be given,
 * each where it overlaps its name most (or lies nearest). A band left over keeps no column.
 */
function matchBands(raw: Omit<Band, "col">[], cols: number[], header: Word[]): Band[] {
  const m = raw.length;
  const k = cols.length;
  const NONE = -Infinity;
  const f = Array.from({ length: m + 1 }, () => new Array<number>(k + 1).fill(NONE));
  const how = Array.from({ length: m + 1 }, () => new Array<number>(k + 1).fill(0));
  f[0]![0] = 0;
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= k; j++) {
      if (i === 0 && j === 0) continue;
      let best = NONE;
      let step = 0;
      if (i > 0 && j > 0 && f[i - 1]![j - 1]! > NONE) {
        const v = f[i - 1]![j - 1]! + overlap(raw[i - 1]!, header[cols[j - 1]!]!);
        if (v > best) [best, step] = [v, 2];
      }
      if (j > 0 && f[i]![j - 1]! > NONE && f[i]![j - 1]! > best) [best, step] = [f[i]![j - 1]!, 1];
      // Leaving a band out costs much more than any distance: every band that can have a column gets one.
      if (i > 0 && f[i - 1]![j]! > NONE && f[i - 1]![j]! - 1e4 * raw[i - 1]!.n > best) [best, step] = [f[i - 1]![j]! - 1e4 * raw[i - 1]!.n, 0];
      f[i]![j] = best;
      how[i]![j] = step;
    }
  }
  const out: Band[] = [];
  for (let i = m, j = k; i > 0 || j > 0; ) {
    const step = how[i]![j]!;
    if (step === 2) out.push({ ...raw[i - 1]!, col: cols[j - 1]! });
    if (step !== 1) i--;
    if (step !== 0) j--;
  }
  return out.reverse();
}

/** Where between lo and hi the fewest pieces of text are cut (rows of transactions count most): the middle of the widest such stretch. */
function quietestCut(lo: number, hi: number, items: { x1: number; x2: number; weight: number }[]): number {
  const events: [number, number][] = [];
  for (const it of items) {
    if (it.x2 <= lo || it.x1 >= hi) continue;
    events.push([Math.max(it.x1, lo), it.weight], [Math.min(it.x2, hi), -it.weight]);
  }
  events.sort((a, b) => a[0] - b[0]);
  let cost = 0;
  let at = lo;
  let e = 0;
  let best = { cost: Infinity, from: lo, to: hi };
  let run: { cost: number; from: number; to: number } | null = null;
  const close = () => {
    if (run && (run.cost < best.cost - 1e-9 || (Math.abs(run.cost - best.cost) <= 1e-9 && run.to - run.from > best.to - best.from))) best = run;
  };
  while (at < hi) {
    while (e < events.length && events[e]![0] <= at) cost += events[e++]![1];
    const to = e < events.length ? Math.min(events[e]![0], hi) : hi;
    if (to > at) {
      if (run && Math.abs(run.cost - cost) <= 1e-9) run.to = to;
      else {
        close();
        run = { cost, from: at, to };
      }
    }
    at = to;
  }
  close();
  return (best.from + best.to) / 2;
}

/** The old reading: edges halfway between the names, every piece where its middle is. */
function headerLayout(header: Word[]): Layout {
  return {
    header,
    roles: header.map((h) => roleOf(h.text)),
    mapping: autoMapping(header.map((h) => h.text)),
    bounds: header.slice(0, -1).map((c, i) => (c.x2 + header[i + 1]!.x1) / 2),
    bands: [],
    starts: header.map(() => null),
    fromBody: false,
  };
}

/** The columns of one header, from the header and the rows under it (every page that repeats it). */
function layoutOf(names: Word[], body: PdfLine[]): Layout {
  const rows = body.map((l) => l.words.flatMap(splitJoinedAmounts));
  const dated = rows.map(isDated);
  const amounts: { w: Word; row: number }[] = [];
  rows.forEach((ws, row) => {
    if (dated[row]) for (const w of ws) if (AMOUNT_ONLY.test(w.text)) amounts.push({ w, row });
  });
  const raw = amounts.length ? bandsOf(amounts) : null;
  if (!raw) return headerLayout(names);

  // "Withdrawal (Dr)/ Deposit (Cr)" was cut into two names, but the rows have one column of marked
  // amounts under both: it is one column, and each amount's Dr / Cr says its side.
  let header = names;
  for (let k = 0; k < header.length - 1; k++) {
    const a = header[k]!;
    const b = header[k + 1]!;
    if (a.piece === undefined || a.piece !== b.piece) continue;
    const ra = roleOf(a.text);
    const rb = roleOf(b.text);
    if (!ra || !rb || !MONEY_ROLES.has(ra) || !MONEY_ROLES.has(rb)) continue;
    const under = raw.filter((band) => overlap(band, a) > 0 || overlap(band, b) > 0);
    const one = under.length === 1 ? under[0]! : null;
    if (one && overlap(one, a) > 0 && overlap(one, b) > 0 && one.marked >= one.n * 0.9) {
      header = [...header.slice(0, k), { ...a, x2: b.x2, text: `${a.text} ${b.text}`.replace(/\s+/g, " ") }, ...header.slice(k + 2)];
    }
  }

  const roles = header.map((h) => roleOf(h.text));
  const moneyCols = roles.flatMap((r, i) => (r && MONEY_ROLES.has(r) ? [i] : []));
  if (!moneyCols.length) return headerLayout(header);
  const bands = matchBands(raw, moneyCols, header);
  const bandOf = new Map(bands.map((b) => [b.col, b]));
  const items = rows.flatMap((ws, row) => ws.map((w) => ({ x1: w.x1, x2: w.x2, weight: dated[row] ? 1 : 0.01 })));
  const middle = (w: Word) => (w.x1 + w.x2) / 2;

  const bounds: number[] = [];
  for (let k = 0; k < header.length - 1; k++) {
    const a = header[k]!;
    const b = header[k + 1]!;
    const loData = bandOf.get(k)?.x2 ?? -Infinity;
    const hiData = bandOf.get(k + 1)?.x1 ?? Infinity;
    // Between the two names, and between the amounts of the two columns.
    let lo = Math.max(a.x2, loData);
    let hi = Math.min(b.x1, hiData);
    if (hi - lo < 0.5) {
      // The names leave no room that fits the amounts: the amounts decide, the names' middles where there are none.
      lo = Number.isFinite(loData) ? loData : Math.min(middle(a), hiData - 0.5);
      hi = Number.isFinite(hiData) ? hiData : Math.max(middle(b), loData + 0.5);
      if (hi - lo < 0.5) {
        const x = (lo + hi) / 2;
        lo = x - 0.25;
        hi = x + 0.25;
      }
    }
    const before = bounds[k - 1] ?? -Infinity;
    if (lo <= before) lo = before + 0.25;
    if (hi < lo + 0.5) hi = lo + 0.5;
    bounds.push(quietestCut(lo, hi, items));
  }

  // Where the text of each text column starts on most rows (a cut piece's second half starts there).
  const starts: (number | null)[] = header.map(() => null);
  const seen = header.map(() => new Map<number, number>());
  rows.forEach((ws, row) => {
    if (!dated[row]) return;
    for (const w of ws) {
      if (AMOUNT_ONLY.test(w.text)) continue;
      const at = Math.round(w.x1 * 2) / 2;
      const m = seen[colAt(bounds, middle(w))]!;
      m.set(at, (m.get(at) ?? 0) + 1);
    }
  });
  seen.forEach((m, k) => {
    let top = 0;
    for (const [x, n] of m) if (n > top) [top, starts[k]] = [n, x];
  });

  return { header, roles, mapping: autoMapping(header.map((h) => h.text)), bounds, bands, starts, fromBody: true };
}

function colAt(bounds: number[], x: number): number {
  const k = bounds.findIndex((b) => x < b);
  return k === -1 ? bounds.length : k;
}

/** Whether a half of a cut piece reads as what its column holds; columns the reader does not use are never cut into. */
function fits(s: string, role: ColumnRole | null): boolean {
  if (!s) return false;
  if (role === "date" || role === "valueDate") return isDateText(s);
  if (role === "reference") return /^\S{3,}$/.test(s) && /\d/.test(s);
  if (role === "narration") return /[A-Za-z]/.test(s);
  if (role && MONEY_ROLES.has(role)) return AMOUNT_ONLY.test(s);
  return false;
}

/**
 * A piece that runs from column k into column k + 1, cut where column k + 1's text starts, at a
 * space or where letters and digits meet, so that both halves read as their columns' text. Null
 * when no such cut is near: the piece then stays whole.
 */
function cutAcross(w: Word, k: number, L: Layout): [Word, Word] | null {
  const left = L.roles[k] ?? null;
  const right = L.roles[k + 1] ?? null;
  const edges = charEdges(w);
  const reach = 1.5 * w.size;
  const money = Boolean(right && MONEY_ROLES.has(right));
  const target = money ? null : (L.starts[k + 1] ?? L.bounds[k]!);
  const from = money ? (L.bands.find((b) => b.col === k + 1)?.x1 ?? L.bounds[k]!) - reach : -Infinity;
  let best: { at: number; score: number } | null = null;
  for (let at = 1; at < w.text.length; at++) {
    const a = w.text[at - 1]!;
    const b = w.text[at]!;
    const space = a === " " || b === " ";
    const joint = space || (/[A-Za-z]/.test(a) && /\d/.test(b)) || (/\d/.test(a) && /[A-Za-z]/.test(b));
    const x = edges[at]!;
    // Elsewhere ("...-881406434764" glued to "0000828374") only right where the column starts.
    if (target !== null ? Math.abs(x - target) > (joint ? reach : 0.2 * w.size) : !joint || x < from) continue;
    if (!fits(w.text.slice(0, at).trim(), left) || !fits(w.text.slice(at).trim(), right)) continue;
    // Nearest the column's start (a space before a letter-digit join, a join before anything else); an amount as long as it reads.
    const score = target !== null ? Math.abs(x - target) + (space ? 0 : joint ? 0.15 * w.size : 0.3 * w.size) : at;
    if (!best || score < best.score) best = { at, score };
  }
  if (!best) return null;
  const x = edges[best.at]!;
  return [
    { ...w, x2: x, text: w.text.slice(0, best.at).trim() },
    { ...w, x1: x, text: w.text.slice(best.at).trim() },
  ];
}

type Piece = { w: Word; col: number };

/** A piece of text in the column it starts in, cut where it runs on into the next one (see cutAcross). */
function placeText(w: Word, L: Layout, minCol: number): Piece[] {
  if (L.fromBody) {
    const tol = Math.max(1, w.size * 0.5);
    for (let k = Math.max(minCol, colAt(L.bounds, w.x1 + 0.01)); k < L.bounds.length; k++) {
      const edge = L.bounds[k]!;
      if (w.x2 <= edge + tol) break;
      if (w.x1 >= edge - tol) continue;
      const cut = cutAcross(w, k, L);
      if (cut) return [{ w: cut[0], col: k }, ...placeText(cut[1], L, k + 1)];
      break;
    }
  }
  return [{ w, col: Math.max(minCol, colAt(L.bounds, (w.x1 + w.x2) / 2)) }];
}

/** The pieces of a line in their columns: an amount in the band it falls in, other text where it sits. */
function piecesOf(line: PdfLine, L: Layout): Piece[] {
  const out: Piece[] = [];
  for (const w of line.words.flatMap(splitJoinedAmounts)) {
    if (AMOUNT_ONLY.test(w.text) && L.bands.length) {
      let band: Band | null = null;
      for (const b of L.bands) if (overlap(b, w) > 0 && (!band || overlap(b, w) > overlap(band, w))) band = b;
      if (band) {
        out.push({ w, col: band.col });
        continue;
      }
    }
    out.push(...placeText(w, L, 0));
  }
  return out;
}

/** Text a narration can wrap into: the narration and reference columns, and columns the reader does not use. */
const WRAPS_INTO = (role: ColumnRole | null) => role === null || role === "narration" || role === "reference";

/** True when every piece of a text-only row lies over columns a narration can wrap into (a footer starts at the margin or runs across the amounts). */
function wrapsLikeNarration(pieces: Piece[], L: Layout): boolean {
  return pieces.every(({ w, col }) => {
    if (!WRAPS_INTO(L.roles[col] ?? null)) return false;
    if (!L.fromBody) return true;
    const tol = Math.max(1, w.size * 0.5);
    for (let c = 0; c < L.header.length; c++) {
      const lo = c === 0 ? -Infinity : L.bounds[c - 1]!;
      const hi = c === L.header.length - 1 ? Infinity : L.bounds[c]!;
      if (Math.min(w.x2, hi) - Math.max(w.x1, lo) > tol && !WRAPS_INTO(L.roles[c] ?? null)) return false;
    }
    return true;
  });
}

type TextItem = { str: string; x: number; y: number; width: number; fontSize: number; height: number };

/** The longest password passed on to the PDF reader; bank statement passwords are a few characters. */
export const MAX_PDF_PASSWORD = 128;

/**
 * A locked PDF: no password was given ("missing") or the one given does not open it ("wrong").
 * The message never contains the password.
 */
export class PdfPasswordError extends StatementReadError {
  override name = "PdfPasswordError";
  constructor(readonly reason: "missing" | "wrong") {
    super(
      reason === "wrong"
        ? "That password does not open this PDF. Check it and try again: the bank's email usually says which password it uses, often your customer ID or date of birth."
        : "This PDF is password protected. Banks often lock statements with your customer ID or date of birth. Type the password to read it, or upload a copy saved without the password.",
    );
  }
}

const SCANNED =
  "This PDF has no readable statement text: it looks like a scanned or photographed statement. Reading scans is not reliable enough for bank figures. Download the statement from net banking as CSV, Excel or a PDF with text, and upload that.";
/** A page of a statement has well over a thousand characters; a scan with a scanner's footer line has a few dozen. */
const SCAN_CHARS_PER_PAGE = 200;

const cellText = (texts: string[]) => texts.join(" ").replace(/\s+/g, " ").trim();

/** Reads a text PDF into rows of cells, the column names first. `password` opens a locked PDF; it is only passed to the PDF reader. */
export async function readPdfStatement(bytes: Buffer, password?: string): Promise<{ grid: GridRow[]; headerIndex: number }> {
  const { getDocumentProxy, extractTextItems } = await import("unpdf");
  let pages: TextItem[][];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes), password ? { password: password.slice(0, MAX_PDF_PASSWORD) } : undefined);
    if (pdf.numPages > MAX_PAGES) {
      throw new StatementReadError(`This PDF has ${pdf.numPages} pages. Upload at most ${MAX_PAGES} pages at a time, or download the statement as CSV or Excel.`);
    }
    pages = (await extractTextItems(pdf)).items as TextItem[][];
  } catch (error) {
    if (error instanceof StatementReadError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      // pdf.js: code 1 is "no password given", code 2 "incorrect password".
      const code = (error as { code?: unknown }).code;
      throw new PdfPasswordError(password && code === 2 ? "wrong" : "missing");
    }
    throw new StatementReadError("This PDF could not be opened. Download the statement again, or as CSV or Excel, and upload that file.");
  }

  const text = pages.flat().map((t) => t.str).join("");
  const chars = text.replace(/\s/g, "").length;
  if (chars < MIN_TEXT) throw new StatementReadError(SCANNED);

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

  // Every place the column names are printed; the lines under each, up to the next.
  const heads: { at: number; span: number; cells: Word[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = headerAt(lines, i);
    if (!header) continue;
    heads.push({ at: i, span: header.span, cells: header.cells });
    i += header.span - 1;
  }

  const grid: GridRow[] = [];
  const firstHead = heads[0];
  if (!firstHead) {
    // No table and hardly any text: a scan that carries a line of text (a scanner app's footer).
    if (chars / Math.max(pages.length, 1) < SCAN_CHARS_PER_PAGE) throw new StatementReadError(SCANNED);
    for (const line of lines) grid.push({ line: grid.length + 1, page: line.page, cells: [phrases(line.words).map((w) => w.text).join("  ")] });
    return { grid, headerIndex: -1 };
  }

  // One set of columns per header that repeats the same way, read from the rows of all its pages,
  // so a page with two lines reads with the columns a full page shows.
  const signature = (cells: Word[]) => cells.map((c) => `${c.text}@${Math.round(c.x1)}:${Math.round(c.x2)}`).join("|");
  const segments = heads.map((h, s) => ({ ...h, from: h.at + h.span, to: heads[s + 1]?.at ?? lines.length, key: signature(h.cells) }));
  const pooled = new Map<string, { cells: Word[]; body: PdfLine[] }>();
  for (const s of segments) {
    const pool = pooled.get(s.key) ?? { cells: s.cells, body: [] };
    pool.body.push(...lines.slice(s.from, s.to));
    pooled.set(s.key, pool);
  }
  const layouts = new Map([...pooled].map(([key, pool]) => [key, layoutOf(pool.cells, pool.body)]));

  // Lines above the table: the account details. Kept as one cell each, for the bank's name.
  for (const line of lines.slice(0, firstHead.at)) grid.push({ line: grid.length + 1, page: line.page, cells: [phrases(line.words).map((w) => w.text).join("  ")] });
  const headerIndex = grid.length;
  const firstLayout = layouts.get(segments[0]!.key)!;
  grid.push({ line: grid.length + 1, page: lines[firstHead.at]!.page, cells: firstLayout.header.map((c) => c.text) });

  type BodyLine = { line: PdfLine; seg: number; cells: string[]; pieces: Piece[]; L: Layout; dated: boolean; money: boolean };
  const body: BodyLine[] = [];
  segments.forEach((s, seg) => {
    const L = layouts.get(s.key)!;
    const at = (role: ColumnRole) => L.mapping.indexOf(role);
    for (const line of lines.slice(s.from, s.to)) {
      const pieces = piecesOf(line, L);
      const parts = L.header.map(() => [] as string[]);
      for (const p of pieces) parts[Math.min(p.col, parts.length - 1)]!.push(p.w.text);
      const cells = parts.map(cellText);
      const cell = (role: ColumnRole) => (at(role) >= 0 ? cells[at(role)]! : "");
      const dated = readDate(cell("date")) !== null || readDate(cell("valueDate")) !== null;
      const money = (["withdrawal", "deposit", "amount", "balance"] as ColumnRole[]).some((r) => {
        const a = readAmount(cell(r));
        return a !== null && a !== "invalid";
      });
      body.push({ line, seg, cells, pieces, L, dated, money });
    }
  });

  // The first and last row of the table on each page: text before the first or after the last is the
  // page's header or footer, and a narration that runs on over a page break skips it.
  const firstRow = new Map<number, number>();
  const lastRow = new Map<number, number>();
  body.forEach((b, i) => {
    if (!b.dated && !b.money) return;
    if (!firstRow.has(b.line.page)) firstRow.set(b.line.page, i);
    lastRow.set(b.line.page, i);
  });
  const rowPages = [...firstRow.keys()];
  const edgeOfPage = (b: BodyLine, i: number) => {
    const p = b.line.page;
    const before = !firstRow.has(p) || i < firstRow.get(p)!;
    const after = !lastRow.has(p) || i > lastRow.get(p)!;
    return (after && rowPages.some((q) => q > p)) || (before && rowPages.some((q) => q < p));
  };

  let lastKept = lines[firstHead.at + firstHead.span - 1]!;
  let open = false;
  let seg = 0;
  body.forEach((b, i) => {
    if (b.seg !== seg) {
      seg = b.seg;
      const h = segments[seg]!;
      lastKept = lines[h.at + h.span - 1]!;
    }
    const { line } = b;
    const near = lastKept.page === line.page && lastKept.y - line.y <= Math.max(lastKept.size, line.size) * 2.4;
    const push = () => grid.push({ line: grid.length + 1, page: line.page, near, cells: b.cells });
    // Above the column names repeated on the next page: that page's header block (the account, the address).
    const next = segments[b.seg + 1];
    if (next && lines[next.at]!.page === line.page && lines[segments[b.seg]!.at]!.page !== line.page) {
      // A line that reads as a transaction is never left out.
      if (b.dated && b.money) push();
      return;
    }
    if (b.dated || b.money) {
      push();
      lastKept = line;
      // A narration wraps under a transaction, not under a total or an opening balance.
      open = b.dated;
      return;
    }
    if (b.pieces.some((p) => PAGE_NUMBER.test(p.w.text)) || PAGE_NUMBER.test(cellText(b.cells))) return;
    if (open && near && wrapsLikeNarration(b.pieces, b.L)) {
      push();
      lastKept = line;
      return;
    }
    // Text that is not the table's: a page's header or footer leaves the last line open for the next page's rows.
    open = open && edgeOfPage(b, i);
  });
  return { grid, headerIndex };
}
