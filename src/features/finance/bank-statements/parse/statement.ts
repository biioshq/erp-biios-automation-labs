/**
 * Turns the rows of a statement into transactions and checks every one against the running
 * balance. Client-safe and pure: the page runs it again when the admin corrects a column.
 *
 * The balance is the statement's own proof of each line: balance = previous balance - withdrawal
 * + deposit, to the paisa. A line that only adds up with its amount on the other side was put in
 * the wrong column (or carries the wrong Dr / Cr mark) and is turned round; a line that adds up
 * neither way is flagged, and the check carries on from the balance the statement shows.
 */

import type { ColumnRole, GridRow, ParsedStatement, StatementLine } from "../types";
import { isHeaderLike } from "./columns";
import { readAmount, readBalance, readDate, readSide, type AmountCell } from "./values";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Half a paisa: balances and amounts are both printed to the paisa. */
const TOLERANCE = 0.005;

/** At most this many lines are read from one statement. */
export const MAX_STATEMENT_LINES = 3000;

type Columns = Partial<Record<ColumnRole, number>>;

function columnsOf(mapping: (ColumnRole | null)[]): Columns {
  const out: Columns = {};
  mapping.forEach((role, i) => {
    if (role && out[role] === undefined) out[role] = i;
  });
  return out;
}

const cell = (cells: string[], i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").replace(/\s+/g, " ").trim());

const OPENING_RE = /opening balance|balance b\/?f|brought forward|balance forward|^b\/f$|\bbalance as (on|at|of)\b/i;
const CLOSING_RE = /closing balance|balance c\/?f|carried forward/i;

/** Lowercase words of a cell, as headerKey makes them ("Balance B/F" is "balance b f"). */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
/**
 * A whole cell that only labels a summary row: "Total", "Total Debits", "Grand Total", "TRANSACTION
 * TOTAL", "Closing Balance", "Opening Balance", "Balance as on 01-Nov-26", "B/F", "C/F". The label has
 * to be the whole cell, so a real narration such as "TOTAL MALL" or "TOTALENERGIES" stays a line.
 */
const SUMMARY_LABEL =
  /^((grand|sub|page|transaction|txn|statement|day|net) )?(sub ?)?totals?( (of|for|debits?|credits?|withdrawals?|deposits?|dr|cr|amounts?|transactions?|count|and|in|out|inr|rs))*$|^(opening|closing|op|cl) bal(ance)?( (inr|rs))?( as (on|at|of)( .*)?)?$|^balance as (on|at|of)( .*)?$|^(bal(ance)? )?(b f|c f|brought forward|carried forward)$|^bal(ance)? forward$/;
const OPENING_LABEL = /^(opening|op) bal|^balance as (on|at|of)|b f$|brought forward$|^balance forward$/;
/** Text that only appears after the table or in a page footer: it never continues a narration. */
const TRAILER_RE =
  /end of (the )?statement|computer generated|system generated|does not require (a |any )?signature|registered office|regd\.? office|^page( no\.?)? ?:? ?\d+( of \d+)?$|^legends?\b|please (examine|check|note)|statement summary/i;

const isSummaryLabel = (s: string) => {
  const k = words(s);
  return k !== "" && SUMMARY_LABEL.test(k);
};

/** A line read from a row, before the balance check. `side` is null when only the balance can tell. */
type Draft = Omit<StatementLine, "withdrawal" | "deposit" | "check"> & { amount: number; side: "dr" | "cr" | null; fromSign: boolean };

/** `summary`: a total, opening or closing row; never a line and never reported as one not read. */
/** `continuation`: wrapped text of the line above, its narration part and its reference part. */
type RowResult = { draft: Draft } | { continuation: { narration: string; reference: string } } | { opening: number } | { summary: true } | { skip: string } | null;

function readRow(row: GridRow, cols: Columns, prevExists: boolean): RowResult {
  const cells = row.cells;
  if (isHeaderLike(cells)) return null;
  const dateRaw = cell(cells, cols.date) || cell(cells, cols.valueDate);
  const date = readDate(dateRaw) ?? (cols.date !== undefined ? readDate(cell(cells, cols.valueDate)) : null);
  const narration = cell(cells, cols.narration);
  const reference = cell(cells, cols.reference);
  const amountCells = [cols.withdrawal, cols.deposit, cols.amount, cols.balance].map((i) => cell(cells, i));
  const anyAmount = amountCells.some((c) => {
    const a = readAmount(c);
    return a !== null && a !== "invalid";
  });

  if (!date) {
    const text = [narration, reference].filter(Boolean).join(" ");
    const joined = cells
      .map((c) => c.trim())
      .filter(Boolean)
      .join(" ");
    const closing = CLOSING_RE.test(joined);
    if (OPENING_RE.test(joined) && !closing && cols.balance !== undefined) {
      const b = readBalance(cell(cells, cols.balance), cell(cells, cols.balanceSide));
      if (typeof b === "number") return { opening: b };
    }
    const labelled = cells.some(isSummaryLabel);
    // A narration that wrapped onto the next row of the file: no date, no amounts, text only in the
    // narration or reference column, right under a line or its wrapped text (`prevExists`), and not
    // a footer ("End of Statement", "Page 2 of 3", a registered office line).
    const onlyText = cells.every((c, i) => i === cols.narration || i === cols.reference || c.trim() === "");
    if (text && onlyText && !anyAmount && !dateRaw && !labelled && prevExists && row.near !== false && !TRAILER_RE.test(text)) {
      // A reference that wrapped in its own column goes on the reference, not the narration.
      return { continuation: cols.narration === undefined ? { narration: text, reference: "" } : { narration, reference } };
    }
    // Total, opening and closing rows, and the figures under a summary header ("Opening Balance, Dr
    // Count..." then the numbers), are not lines and not rows that failed to read.
    if (labelled || closing || (anyAmount && OPENING_RE.test(joined)) || (dateRaw !== "" && readAmount(dateRaw) !== "invalid")) return { summary: true };
    if (anyAmount && (dateRaw || narration)) {
      return { skip: dateRaw ? `The date "${dateRaw}" could not be read` : "No date on this row" };
    }
    return null;
  }

  // A dated summary row ("31/05/25, Total Debits, 72,80,507.58") is never a line. The opening one
  // gives the balance the first line starts from.
  if (isSummaryLabel(narration)) {
    const k = words(narration);
    if (OPENING_LABEL.test(k) && !CLOSING_RE.test(narration) && cols.balance !== undefined) {
      const b = readBalance(cell(cells, cols.balance), cell(cells, cols.balanceSide));
      if (typeof b === "number") return { opening: b };
    }
    return { summary: true };
  }

  if (OPENING_RE.test(narration) && !CLOSING_RE.test(narration) && cols.balance !== undefined) {
    const w = readAmount(cell(cells, cols.withdrawal));
    const d = readAmount(cell(cells, cols.deposit));
    const a = readAmount(cell(cells, cols.amount));
    const noMoney = [w, d, a].every((x) => x === null || (x !== "invalid" && x.value === 0));
    const b = readBalance(cell(cells, cols.balance), cell(cells, cols.balanceSide));
    if (noMoney && typeof b === "number") return { opening: b };
  }

  let amount = 0;
  let side: "dr" | "cr" | null = null;
  let fromSign = false;
  const issues: string[] = [];
  if (cols.withdrawal !== undefined || cols.deposit !== undefined) {
    const w = readAmount(cell(cells, cols.withdrawal));
    const d = readAmount(cell(cells, cols.deposit));
    if (w === "invalid" || d === "invalid") return { skip: "The amount could not be read" };
    const wv = w?.value ?? 0;
    const dv = d?.value ?? 0;
    if (wv > 0 && dv > 0) return { skip: "This row has both a withdrawal and a deposit" };
    if (wv > 0) {
      // A minus in the withdrawal column ("-500.00") is still a withdrawal.
      amount = wv;
      side = "dr";
    } else if (dv > 0) {
      amount = dv;
      side = "cr";
    }
    // Only one of the two columns mapped: the sign tells the side.
    if (cols.withdrawal === undefined || cols.deposit === undefined) {
      const only = (w ?? d) as AmountCell | null;
      if (only) {
        side = only.side ?? (only.negative ? "dr" : cols.withdrawal !== undefined ? "dr" : "cr");
        fromSign = true;
      }
    }
  } else {
    const a = readAmount(cell(cells, cols.amount));
    if (a === "invalid") return { skip: "The amount could not be read" };
    amount = a?.value ?? 0;
    side = a?.side ?? readSide(cell(cells, cols.drcr));
    if (!side && a) {
      side = a.negative ? "dr" : null;
      fromSign = true;
    }
  }
  if (amount <= 0) return anyAmount || narration ? { skip: "No amount on this row" } : null;

  const balanceCell = cell(cells, cols.balance);
  const balance = readBalance(balanceCell, cell(cells, cols.balanceSide));
  if (balance === "invalid") issues.push(`The balance "${balanceCell}" could not be read`);
  const valueDate = readDate(cell(cells, cols.valueDate)) ?? undefined;
  // The file's own vendor and category columns ride along with the line; they are never part of its hash.
  const vendor = cell(cells, cols.vendor).slice(0, 200) || undefined;
  const category = cell(cells, cols.category).slice(0, 80) || undefined;
  return {
    draft: {
      vendor,
      category,
      line: row.line,
      page: row.page,
      date,
      valueDate: valueDate && valueDate !== date ? valueDate : undefined,
      narration,
      reference: reference || undefined,
      balance: typeof balance === "number" ? balance : null,
      issues,
      amount,
      side,
      fromSign,
    },
  };
}

/** Runs the balance check over drafts in date order. Returns the lines and how many reconcile. */
function reconcile(drafts: Draft[], opening: number | null): { lines: StatementLine[]; ok: number } {
  let prev = opening;
  let ok = 0;
  const lines = drafts.map((d): StatementLine => {
    let side = d.side;
    let check: StatementLine["check"] = "unchecked";
    const issues = [...d.issues];
    if (d.balance !== null && prev !== null) {
      const asDr = round2(prev - d.amount);
      const asCr = round2(prev + d.amount);
      const fitsDr = Math.abs(d.balance - asDr) < TOLERANCE;
      const fitsCr = Math.abs(d.balance - asCr) < TOLERANCE;
      if ((side === "dr" && fitsDr) || (side === "cr" && fitsCr)) check = "ok";
      else if (side === null && (fitsDr || fitsCr)) {
        side = fitsDr ? "dr" : "cr";
        check = "ok";
      } else if (fitsDr || fitsCr) {
        side = fitsDr ? "dr" : "cr";
        check = "fixed";
        issues.push(
          side === "dr"
            ? "Shown as a deposit, but the balance went down by this amount, so it is read as a withdrawal"
            : "Shown as a withdrawal, but the balance went up by this amount, so it is read as a deposit",
        );
      } else {
        check = "mismatch";
        const expected = side === "cr" ? asCr : asDr;
        issues.push(`The balance does not follow from the line before: expected ${expected.toFixed(2)}, the statement shows ${d.balance.toFixed(2)}`);
      }
      if (check !== "mismatch") ok++;
    }
    if (side === null) {
      side = "dr";
      issues.push("The statement does not say whether this is a withdrawal or a deposit; it is read as a withdrawal. Check it");
    } else if (check === "unchecked" && d.fromSign) {
      issues.push("No balance to confirm the side; it is taken from the sign of the amount");
    }
    if (d.balance !== null) prev = d.balance;
    else if (prev !== null) prev = round2(prev + (side === "cr" ? d.amount : -d.amount));
    return {
      line: d.line,
      page: d.page,
      date: d.date,
      valueDate: d.valueDate,
      narration: d.narration,
      reference: d.reference,
      withdrawal: side === "dr" ? d.amount : 0,
      deposit: side === "cr" ? d.amount : 0,
      balance: d.balance,
      check,
      issues,
      ...(d.vendor ? { vendor: d.vendor } : {}),
      ...(d.category ? { category: d.category } : {}),
    };
  });
  return { lines, ok };
}

/** A cell that starts with an opening balance label: "Opening Balance (INR ) : 23,45,678.90", "Balance as on 01-Nov-26". */
const OPENING_START = /^((opening|op) bal(ance)?|balance as (on|at|of)|(balance )?b f|brought forward)\b/;
/** A cell that is only that label, the column name of a summary block ("Opening Balance, Dr Count, ..."). */
const OPENING_ONLY = /^(opening|op) bal(ance)?( (inr|rs))?$/;

/**
 * The opening balance printed outside the table: in the account block above the column names (the
 * figure after the label's colon, or in the next cell), or as the "Opening Balance" column of a
 * summary block, with the figure in the row under it, above the table or after its last line. Null
 * unless exactly one figure is found.
 */
function openingAround(grid: GridRow[], headerIndex: number, lastDraftIndex: number): number | null {
  const found = new Set<number>();
  const look = (i: number) => {
    const cells = grid[i]!.cells.map((c) => c.replace(/\s+/g, " ").trim());
    cells.forEach((t, j) => {
      const k = words(t);
      if (!OPENING_START.test(k) || CLOSING_RE.test(t)) return;
      const colon = t.lastIndexOf(":");
      const after = colon >= 0 ? t.slice(colon + 1).trim() : "";
      // A figure with its paise or commas, so the minutes of a time ("10:42") are never read.
      if (after && /\d[.,]\d/.test(after)) {
        const b = readBalance(after);
        if (typeof b === "number") found.add(b);
        return;
      }
      // The figure in the next cell with text, past a date ("Balance as on", "01-Nov-26", "98,765.43").
      let n = j + 1;
      while (n < cells.length && (cells[n] === "" || cells[n] === ":" || (readDate(cells[n]) !== null && readAmount(cells[n]) === "invalid"))) n++;
      if (n < cells.length) {
        const b = readBalance(cells[n], cells[n + 1]);
        if (typeof b === "number") {
          found.add(b);
          return;
        }
      }
      if (!OPENING_ONLY.test(k)) return;
      const below = grid[i + 1];
      if (!below || (i < headerIndex && i + 1 >= headerIndex)) return;
      const b = readBalance((below.cells[j] ?? "").trim());
      if (typeof b === "number") found.add(b);
    });
  };
  for (let i = 0; i < headerIndex; i++) look(i);
  for (let i = lastDraftIndex + 1; i < grid.length; i++) look(i);
  return found.size === 1 ? [...found][0]! : null;
}

/** Reads the transactions under the header row with the given column roles. */
export function buildStatement(grid: GridRow[], headerIndex: number, mapping: (ColumnRole | null)[]): ParsedStatement {
  const cols = columnsOf(mapping);
  const drafts: Draft[] = [];
  const skipped: ParsedStatement["skipped"] = [];
  let stated: number | null = null;
  // True while the row above was a line or its wrapped text. Anything else (a total, an opening or
  // closing row, a row not read, a footer, a repeated header) ends the run, so text after the table
  // or under a page's last line is never glued onto a narration. Lines after it are still read.
  let chain = false;
  let lastDraftIndex = headerIndex;
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]!;
    if (drafts.length >= MAX_STATEMENT_LINES) {
      skipped.push({ line: row.line, reason: `Only the first ${MAX_STATEMENT_LINES} lines of a statement are read. Upload the rest as another file` });
      break;
    }
    const r = readRow(row, cols, drafts.length > 0 && chain);
    chain = r !== null && ("draft" in r || "continuation" in r);
    if (!r) continue;
    if ("draft" in r) {
      drafts.push(r.draft);
      lastDraftIndex = i;
    } else if ("continuation" in r) {
      const last = drafts[drafts.length - 1]!;
      if (r.continuation.narration) last.narration = `${last.narration} ${r.continuation.narration}`.trim().slice(0, 1000);
      // References have no spaces: the second line of a wrapped one is joined straight on.
      if (r.continuation.reference) last.reference = `${last.reference ?? ""}${r.continuation.reference}`.slice(0, 200);
    } else if ("opening" in r) {
      if (drafts.length === 0) stated = r.opening;
    } else if ("skip" in r) skipped.push({ line: row.line, reason: r.skip });
  }
  // No opening row in the table: the one printed in the account block above it, or in the summary
  // under it, so the first line is checked too.
  if (stated === null && cols.balance !== undefined && drafts.length > 0) stated = openingAround(grid, headerIndex, lastDraftIndex);

  // Oldest first. A statement listed newest first is turned round; one day only is tried both ways.
  const first = drafts[0]?.date ?? "";
  const last = drafts[drafts.length - 1]?.date ?? "";
  let newestFirst = first > last;
  let ordered = newestFirst ? [...drafts].reverse() : drafts;
  let result = reconcile(ordered, newestFirst ? null : stated);
  if (first === last && drafts.length > 1) {
    const reversed = reconcile([...drafts].reverse(), null);
    if (reversed.ok > result.ok) {
      newestFirst = true;
      ordered = [...drafts].reverse();
      result = reversed;
    }
  }
  const lines = result.lines;

  const firstLine = lines[0];
  const opening =
    !newestFirst && stated !== null
      ? stated
      : firstLine && firstLine.balance !== null
        ? round2(firstLine.balance + firstLine.withdrawal - firstLine.deposit)
        : null;
  const withBalance = [...lines].reverse().find((l) => l.balance !== null);
  let closing: number | null = null;
  if (withBalance) {
    // Lines after the last printed balance move it on.
    const after = lines.slice(lines.indexOf(withBalance) + 1);
    closing = round2(after.reduce((s, l) => s + l.deposit - l.withdrawal, withBalance.balance!));
  }
  return {
    lines,
    skipped,
    from: lines.length ? lines.reduce((m, l) => (l.date < m ? l.date : m), lines[0]!.date) : null,
    to: lines.length ? lines.reduce((m, l) => (l.date > m ? l.date : m), lines[0]!.date) : null,
    opening,
    closing,
    openingStated: !newestFirst && stated !== null,
    totalDeposits: round2(lines.reduce((s, l) => s + l.deposit, 0)),
    totalWithdrawals: round2(lines.reduce((s, l) => s + l.withdrawal, 0)),
    newestFirst,
    fixed: lines.filter((l) => l.check === "fixed").length,
    mismatches: lines.filter((l) => l.check === "mismatch").length,
    unchecked: lines.filter((l) => l.check === "unchecked").length,
  };
}
