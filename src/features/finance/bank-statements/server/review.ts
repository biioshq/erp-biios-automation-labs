import "server-only";

import { Types } from "mongoose";
import { AccountTransfer, BankAccount, BankTransaction, CapitalEntry, EquityHolder, Expense, Income, Liability } from "@/server/models";
import { notFound } from "@/server/errors";
import { loadAccountBook, type AccountBook } from "@/server/accounts";
import { COMPANY } from "@/config/company";
import { maybeUnpaidFilter, paymentState } from "@/lib/payments";
import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { BankLineAction } from "@/lib/constants";
import type { LineDecision, MatchKind, MatchOption, ReviewLine, StatementLine, StatementPickers } from "../types";
import { STATEMENT_METHODS } from "../schemas";
import { analyseNarration, categoryFromWords, containsName, nameKey, nameSimilarity } from "../parse/narration";
import { lineHash, occurrences } from "./hash";
import { isReopenable } from "./claims";
import { describeLinks } from "./links";
import { loadClientNames, loadOwnAccounts, loadPickers, loadVendorHistory, type OwnAccount, type VendorHistory } from "./context";

/**
 * The review of a statement before anything is saved: which lines were imported before, which
 * match a record already in the books (same side, same amount to the paisa, within three days,
 * the closest and best-named first), and what each other line most likely is.
 *
 * A record counts for this account when the books put its money there (src/server/accounts.ts).
 * A record with no account whose method's default is another account is still offered, marked,
 * because it is often the same payment entered without picking an account; one that names
 * another account is not.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86_400_000;
/** Lines and records further apart than this are never the same payment. */
const MATCH_DAYS = 3;

type Side = "dr" | "cr";
type Candidate = Omit<MatchOption, "score"> & { side: Side; party: string; refs: string[] };

const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY;
const sideOf = (l: StatementLine): Side => (l.withdrawal > 0 ? "dr" : "cr");
const amountOf = (l: StatementLine) => (l.withdrawal > 0 ? l.withdrawal : l.deposit);
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Where a record's money is in the books: this account, another one (when it named none), or nowhere near. */
function placement(book: AccountBook, target: string, method: string | null | undefined, account: unknown): { ok: boolean; other?: string } {
  const code = book.resolve(method ?? "bank_transfer", account);
  if (code === target) return { ok: true };
  if (account || !code?.startsWith("cash:") || method === "cash" || method === "credit" || method === "stock" || method === "biios_startup_llp") return { ok: false };
  return { ok: true, other: book.byCode.get(code)?.name ?? "another account" };
}

async function loadCandidates(accountId: string, book: AccountBook, from: Date, to: Date): Promise<Candidate[]> {
  const target = `cash:${accountId}`;
  const range = { $gte: from, $lte: to };
  const out: Candidate[] = [];
  const add = (c: Candidate) => out.push(c);

  const [expenses, bills, incomes, loans, entries, transfers, holders, accounts] = await Promise.all([
    Expense.find(
      {
        countedAtPurchase: { $ne: true },
        // Loan interest is part of its repayment, which is offered as one line.
        source: { $nin: ["inventory_assignment", "inventory_wastage", "liability_interest"] },
        $or: [{ date: range, payments: { $exists: false } }, { "payments.date": range }],
      },
      { number: 1, vendor: 1, amount: 1, date: 1, paymentMethod: 1, account: 1, payments: 1, bankTransaction: 1, gst: 1 },
    ).lean(),
    Expense.find(
      { ...maybeUnpaidFilter(), countedAtPurchase: { $ne: true }, source: { $nin: ["inventory_assignment", "inventory_wastage"] }, date: { $lte: to } },
      { number: 1, vendor: 1, amount: 1, date: 1, dueDate: 1, paymentMethod: 1, account: 1, payments: 1, gst: 1 },
    )
      .sort({ date: -1 })
      .limit(3000)
      .lean(),
    Income.find({ date: range }, { number: 1, client: 1, amount: 1, date: 1, paymentMethod: 1, account: 1, reference: 1, bankTransaction: 1 }).lean(),
    Liability.find({ $or: [{ date: range, "source.mode": "account" }, { "payments.date": range }] }, { code: 1, name: 1, lender: 1, originalAmount: 1, date: 1, source: 1, payments: 1, reference: 1, bankTransaction: 1 }).lean(),
    CapitalEntry.find({ date: range, type: { $in: ["capital", "drawing", "dividend"] } }, { number: 1, type: 1, holder: 1, amount: 1, date: 1, paymentMethod: 1, account: 1, reference: 1, bankTransaction: 1 }).lean(),
    AccountTransfer.find({ date: range, $or: [{ from: new Types.ObjectId(accountId) }, { to: new Types.ObjectId(accountId) }] }).lean(),
    EquityHolder.find({}, { name: 1 }).lean(),
    BankAccount.find({}, { name: 1 }).lean(),
  ]);
  const holderName = new Map(holders.map((h) => [String(h._id), h.name]));
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));

  for (const e of expenses) {
    const refs = [e.number, e.gst?.invoiceNumber ?? ""].filter(Boolean);
    if (!Array.isArray(e.payments)) {
      if (e.paymentMethod === "credit" || e.bankTransaction) continue;
      const p = placement(book, target, e.paymentMethod, e.account);
      if (!p.ok) continue;
      add({ key: `expense:${e._id}`, kind: "expense", id: String(e._id), label: `${e.number} · ${e.vendor}`, detail: "Expense paid on its date", href: `/finance/expenses?view=${e._id}`, amount: e.amount, date: toDateInput(e.date), side: "dr", party: e.vendor, refs, otherAccount: p.other });
      continue;
    }
    for (const pay of e.payments) {
      if (pay.bankTransaction || pay.date < from || pay.date > to) continue;
      const p = placement(book, target, pay.paymentMethod, pay.account);
      if (!p.ok) continue;
      add({
        key: `expensePayment:${pay._id}`,
        kind: "expensePayment",
        id: String(pay._id),
        parentId: String(e._id),
        label: `Payment on ${e.number} · ${e.vendor}`,
        detail: pay.amount < e.amount ? `Part payment of ${e.amount.toFixed(2)}` : "Payment recorded on the expense",
        href: `/finance/expenses?view=${e._id}`,
        amount: pay.amount,
        date: toDateInput(pay.date),
        side: "dr",
        party: e.vendor,
        refs: [...refs, pay.reference ?? ""].filter(Boolean),
        otherAccount: p.other,
      });
    }
  }

  for (const e of bills) {
    const state = paymentState(e);
    if (state.outstanding <= 0) continue;
    add({
      key: `bill:${e._id}`,
      kind: "bill",
      id: String(e._id),
      label: `Pays ${e.number} · ${e.vendor}`,
      detail: `Unpaid bill, ${state.outstanding.toFixed(2)} outstanding. The payment is added to it`,
      href: `/finance/expenses?view=${e._id}`,
      amount: state.outstanding,
      date: toDateInput(e.date),
      side: "dr",
      party: e.vendor,
      refs: [e.number, e.gst?.invoiceNumber ?? ""].filter(Boolean),
    });
  }

  for (const i of incomes) {
    if (i.bankTransaction) continue;
    const p = placement(book, target, i.paymentMethod, i.account);
    if (!p.ok) continue;
    add({ key: `income:${i._id}`, kind: "income", id: String(i._id), label: `${i.number} · ${i.client}`, detail: "Income recorded", href: `/finance/income?view=${i._id}`, amount: i.amount, date: toDateInput(i.date), side: "cr", party: i.client, refs: [i.number, i.reference ?? ""].filter(Boolean), otherAccount: p.other });
  }

  for (const l of loans) {
    const href = `/finance/liabilities/loans?view=${l._id}`;
    if (l.source?.mode === "account" && !l.bankTransaction && l.date >= from && l.date <= to) {
      const p = placement(book, target, l.source.paymentMethod ?? "bank_transfer", l.source.account);
      if (p.ok) add({ key: `liability:${l._id}`, kind: "liability", id: String(l._id), label: `${l.code} · ${l.name}`, detail: "Loan received", href, amount: l.originalAmount, date: toDateInput(l.date), side: "cr", party: l.lender, refs: [l.code, l.reference ?? ""].filter(Boolean), otherAccount: p.other });
    }
    for (const pay of l.payments ?? []) {
      if (pay.bankTransaction || pay.date < from || pay.date > to) continue;
      const p = placement(book, target, pay.paymentMethod ?? "bank_transfer", pay.account);
      if (!p.ok) continue;
      const total = round2((pay.principal ?? 0) + (pay.interest ?? 0));
      add({ key: `liabilityPayment:${pay._id}`, kind: "liabilityPayment", id: String(pay._id), parentId: String(l._id), label: `Repayment on ${l.code} · ${l.name}`, detail: `Principal ${(pay.principal ?? 0).toFixed(2)}, interest ${(pay.interest ?? 0).toFixed(2)}`, href, amount: total, date: toDateInput(pay.date), side: "dr", party: l.lender, refs: [pay.reference ?? ""].filter(Boolean), otherAccount: p.other });
    }
  }

  for (const c of entries) {
    if (c.bankTransaction) continue;
    const p = placement(book, target, c.paymentMethod ?? "bank_transfer", c.account);
    if (!p.ok) continue;
    const party = c.holder ? (holderName.get(String(c.holder)) ?? "") : "";
    const what = c.type === "capital" ? "Capital introduced" : c.type === "drawing" ? "Drawing" : "Dividend";
    add({ key: `capitalEntry:${c._id}`, kind: "capitalEntry", id: String(c._id), label: `${c.number} · ${what}${party ? `, ${party}` : ""}`, detail: what, href: `/finance/equity?view=${c._id}`, amount: c.amount, date: toDateInput(c.date), side: c.type === "capital" ? "cr" : "dr", party, refs: [c.number, c.reference ?? ""].filter(Boolean), otherAccount: p.other });
  }

  // A transfer already tied to one of this account's lines is done on this side.
  const transferTxns = transfers.flatMap((t) => t.bankTransactions ?? []);
  const ownSide = new Set(
    transferTxns.length ? (await BankTransaction.find({ _id: { $in: transferTxns }, account: new Types.ObjectId(accountId) }, { _id: 1 }).lean()).map((t) => String(t._id)) : [],
  );
  for (const t of transfers) {
    if ((t.bankTransactions ?? []).some((id) => ownSide.has(String(id)))) continue;
    const outgoing = String(t.from) === accountId;
    const other = accountName.get(String(outgoing ? t.to : t.from)) ?? "another account";
    add({ key: `accountTransfer:${t._id}`, kind: "accountTransfer", id: String(t._id), label: outgoing ? `Transfer to ${other}` : `Transfer from ${other}`, detail: "Transfer between own accounts", href: "/finance/assets/cash", amount: t.amount, date: toDateInput(t.date), side: outgoing ? "dr" : "cr", party: other, refs: [t.reference ?? ""].filter(Boolean) });
  }
  return out;
}

function toOption(c: Candidate, score: number): MatchOption {
  return { key: c.key, kind: c.kind, id: c.id, parentId: c.parentId, label: c.label, detail: c.detail, href: c.href, amount: c.amount, date: c.date, score: Math.round(score), otherAccount: c.otherAccount };
}

/** The narration names the record's party, or carries one of its numbers. */
function namedIn(line: StatementLine, c: Candidate): { sim: number; refHit: boolean } {
  const text = `${line.narration} ${line.reference ?? ""}`;
  const hay = alnum(text);
  return { sim: c.party ? nameSimilarity(c.party, text) : 0, refHit: c.refs.some((r) => alnum(r).length >= 4 && hay.includes(alnum(r))) };
}

/** How well a record fits a line, or null when it cannot be the same payment. */
function pairScore(line: StatementLine, c: Candidate): number | null {
  if (c.side !== sideOf(line)) return null;
  // Part of an unpaid bill: a line for less than what is still owed, when the narration names the vendor.
  const part = c.kind === "bill" && amountOf(line) < c.amount - 0.005;
  if (!part && Math.abs(c.amount - amountOf(line)) >= 0.005) return null;
  const days = dayNumber(line.date) - dayNumber(c.date);
  const { sim, refHit } = namedIn(line, c);
  if (c.kind === "bill") {
    // A bill is paid on or after its date; long after only when the narration names the vendor.
    if (days < -MATCH_DAYS) return null;
    if (part) return sim >= 0.5 || refHit ? 20 + sim * 40 + (refHit ? 30 : 0) - Math.min(Math.abs(days), 30) : null;
    if (sim < 0.5 && !refHit && days > 30) return null;
    return 40 + sim * 40 + (refHit ? 30 : 0) - Math.min(Math.abs(days), 30);
  }
  if (Math.abs(days) > MATCH_DAYS) return null;
  return 100 - Math.abs(days) * 15 + sim * 30 + (refHit ? 40 : 0) - (c.otherAccount ? 25 : 0);
}

type Context = {
  accountId: string;
  openingDate: Date | null;
  bankName: string;
  own: OwnAccount[];
  vendors: VendorHistory[];
  vendorByKey: Map<string, VendorHistory>;
  clients: string[];
  pickers: StatementPickers;
  holders: { id: string; name: string; kind: string }[];
  loans: { id: string; lender: string; name: string; installment: number | null }[];
};

const allowedCategory = (ctx: Context, value: string | null | undefined) =>
  value && ctx.pickers.categories.some((c) => c.value === value) ? value : null;

/** The longest known name whose distinctive words all appear in the narration. */
function knownName(names: string[], narration: string): string | null {
  let best: string | null = null;
  for (const n of names) {
    if (nameKey(n).replace(/ /g, "").length < 4) continue;
    if (containsName(n, narration) && (!best || n.length > best.length)) best = n;
  }
  return best;
}

/**
 * Another own account the narration names: by its number (masked "XXXXXX1234" or a full account
 * number ending in its last four digits) or by its name. A bare four-digit number is not enough:
 * ATM ids and references are full of them.
 */
function ownAccountIn(ctx: Context, narration: string): OwnAccount | null {
  // A masked account number not glued to digits before it (a card number is "4567XXXXXXXX1234"), or a
  // full number written after "A/c". Bare long numbers are UPI, IMPS and NEFT references, not accounts.
  const masked = narration.match(/(?<![\dx*])[x*]{2,}\d{4}\b/gi) ?? [];
  const written = [...narration.matchAll(/\b(?:a\/?c|acct|account)(?:\s*no)?[\s.:#-]*(\d{9,18})\b/gi)].map((m) => m[1]!);
  const numbers = [...masked, ...written];
  for (const a of ctx.own) {
    if (a.id === ctx.accountId || a.archived) continue;
    if (a.last4 && numbers.some((d) => d.endsWith(a.last4!))) return a;
    if (nameKey(a.name).length >= 6 && containsName(a.name, narration) && a.kind === "bank") return a;
  }
  return null;
}

const cleanNarration = (n: string) => n.replace(/\s+/g, " ").trim().slice(0, 80);

/** What an unmatched line most likely is, with notes for what the admin should check. */
function suggest(line: StatementLine, ctx: Context): { decision: LineDecision; notes: string[]; attention: boolean } {
  const side = sideOf(line);
  const amount = amountOf(line);
  const info = analyseNarration(line.narration, side, { exclude: [COMPANY.name] });
  const notes: string[] = [];
  let attention = false;
  const method = (STATEMENT_METHODS as readonly string[]).includes(info.method) ? info.method : "bank_transfer";
  const base = { paymentMethod: method === "cash" ? "bank_transfer" : method } as LineDecision;
  const decide = (action: BankLineAction, extra: Partial<LineDecision> = {}): LineDecision => ({ ...base, action, ...extra });

  if (side === "dr" && info.kind === "atm") {
    const cash = ctx.own.find((a) => a.kind === "cash" && !a.archived && a.id !== ctx.accountId);
    notes.push("Cash withdrawal: it moves money into cash in hand. Record what the cash was spent on as expenses paid in cash.");
    if (!cash) {
      notes.push("No cash account is set up. Add one on Cash & bank, or pick another action.");
      attention = true;
    }
    return { decision: decide("transfer", { otherAccountId: cash?.id, paymentMethod: "bank_transfer" }), notes, attention };
  }

  const otherOwn = ownAccountIn(ctx, line.narration);
  if (otherOwn && info.kind !== "charges" && info.kind !== "interest") {
    notes.push(`The narration names your account ${otherOwn.name}, so this is read as a transfer between your own accounts.`);
    return { decision: decide("transfer", { otherAccountId: otherOwn.id, paymentMethod: "bank_transfer" }), notes, attention };
  }

  if (side === "dr") {
    if (info.kind === "loan" && ctx.loans.length) {
      const loan =
        ctx.loans.find((l) => l.installment !== null && Math.abs(l.installment - amount) < 0.005) ??
        ctx.loans.find((l) => nameSimilarity(l.lender, line.narration) >= 0.5 || nameSimilarity(l.name, line.narration) >= 0.5);
      if (loan) {
        notes.push("Looks like a loan instalment. Split it into principal and interest from the lender's schedule; the interest is booked as an expense.");
        return { decision: decide("loan_payment", { loanId: loan.id, principal: amount, interest: 0 }), notes, attention: true };
      }
    }
    if (info.kind === "loan") {
      notes.push("Looks like a loan instalment, but no loan in Liabilities matches it. Add the loan there, then choose Loan repayment here.");
      attention = true;
    }
    if (info.kind === "charges") {
      return {
        decision: decide("expense", { party: ctx.bankName, category: allowedCategory(ctx, "interest") ?? "other", description: "Bank charges" }),
        notes: ["Bank charges: booked under interest and bank charges."],
        attention,
      };
    }
    if (info.kind === "tax") {
      notes.push("Looks like a tax payment (GST, TDS, PF or similar). Tax that settles an amount already owed is not an expense; check before adding it.");
      attention = true;
    }
    const known = knownName(ctx.vendors.map((v) => v.name), line.narration);
    const party = known ?? info.payee;
    const history = party ? ctx.vendorByKey.get(party.toLowerCase().replace(/\s+/g, " ")) : undefined;
    const category =
      (info.kind === "salary" ? allowedCategory(ctx, "salaries") : null) ??
      allowedCategory(ctx, history?.category) ??
      allowedCategory(ctx, categoryFromWords(line.narration)) ??
      allowedCategory(ctx, "other") ??
      ctx.pickers.categories[0]?.value;
    if (history) notes.push(`Category from ${history.count === 1 ? "an earlier expense" : `${history.count} earlier expenses`} with ${history.name}.`);
    if (!party) {
      notes.push("The narration has no payee name. Check the vendor.");
      attention = true;
    }
    const owner = party ? ctx.holders.find((h) => h.kind === "owner" && containsName(h.name, line.narration)) : undefined;
    if (owner) notes.push(`Paid to ${owner.name}, an owner. If it was a drawing, choose Owner drawing.`);
    return { decision: decide("expense", { party: party ?? cleanNarration(line.narration), category, holderId: owner?.id }), notes, attention };
  }

  // Deposits.
  if (info.kind === "interest") {
    return { decision: decide("income", { party: ctx.bankName, incomeCategory: "interest" }), notes: ["Interest from the bank: booked as interest income."], attention };
  }
  const holder = ctx.holders.find((h) => containsName(h.name, line.narration));
  if (holder) {
    notes.push(`From ${holder.name}, ${holder.kind === "investor" ? "an investor" : "an owner"}: read as capital introduced. Change it if it was something else.`);
    return { decision: decide("capital", { holderId: holder.id, party: holder.name }), notes, attention: true };
  }
  if (info.kind === "loan" && /disb|sanction/i.test(line.narration)) {
    const lender = info.payee ?? cleanNarration(line.narration);
    notes.push("Looks like a loan paid out to you. Pick the group it belongs to.");
    return { decision: decide("loan_received", { party: lender, loanName: `Loan from ${lender}`.slice(0, 160) }), notes, attention: true };
  }
  if (info.kind === "refund") {
    notes.push("Looks like a refund or reversal. If it reverses a withdrawal, choose Ignore, or match it, instead of income.");
    attention = true;
  }
  const known = knownName(ctx.clients, line.narration);
  const party = known ?? info.payee;
  if (!party) {
    notes.push("The narration has no payer name. Check the client.");
    attention = true;
  }
  return { decision: decide("income", { party: party ?? cleanNarration(line.narration), incomeCategory: "project_payment" }), notes, attention };
}

async function loadContext(accountId: string): Promise<{ ctx: Context; book: AccountBook }> {
  const account = await BankAccount.findById(accountId, { name: 1, bankName: 1, openingDate: 1 }).lean();
  if (!account) throw notFound("The bank account");
  const [book, own, history, clients, pickers, holders, loans] = await Promise.all([
    loadAccountBook(),
    loadOwnAccounts(),
    loadVendorHistory(),
    loadClientNames(),
    loadPickers(),
    EquityHolder.find({ archivedAt: null }, { name: 1, kind: 1 }).lean(),
    Liability.find({ archivedAt: null }, { name: 1, lender: 1, installment: 1 }).lean(),
  ]);
  return {
    book,
    ctx: {
      accountId,
      openingDate: account.openingDate ?? null,
      bankName: account.bankName || account.name,
      own,
      vendors: [...history.values()],
      vendorByKey: history,
      clients,
      pickers,
      holders: holders.map((h) => ({ id: String(h._id), name: h.name, kind: h.kind })),
      loans: loans.map((l) => ({ id: String(l._id), lender: l.lender, name: l.name, installment: l.installment ?? null })),
    },
  };
}

const words = (s: string) => new Set(nameKey(s).split(" ").filter((w) => w.length >= 3));

/** Two narrations of one payment: the same reference, or at least half the words of the shorter one. */
function sameText(l: StatementLine, t: { narration?: string | null; reference?: string | null }): boolean {
  if (l.reference && t.reference && alnum(l.reference) === alnum(t.reference) && alnum(l.reference).length >= 4) return true;
  const a = words(l.narration);
  const b = words(t.narration ?? "");
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5;
}

type ImportedTwin = { action: string; link?: { kind: string; id: Types.ObjectId } | null; createdAt: Date; unmatched: boolean };

/**
 * Lines of an earlier upload that are very likely the same as a new line although their hash
 * differs: the same day, amount and side (and the same balance when both show one). This catches the
 * same statement downloaded again in another format, where the narration is spaced or wrapped
 * differently. Each earlier line answers for one new line at most.
 */
async function importedLookalikes(accountId: string, lines: StatementLine[], fresh: number[], hashes: string[]): Promise<Map<number, ImportedTwin>> {
  const out = new Map<number, ImportedTwin>();
  if (!fresh.length) return out;
  const days = [...new Set(fresh.map((i) => lines[i]!.date))].map(fromDateInput);
  const prior = await BankTransaction.find(
    // Lines this upload already found by their exact hash answer for those lines only.
    { account: new Types.ObjectId(accountId), date: { $in: days }, hash: { $nin: hashes } },
    { date: 1, withdrawal: 1, deposit: 1, balance: 1, narration: 1, reference: 1, action: 1, link: 1, createdAt: 1, updatedAt: 1, unmatchedAt: 1 },
  ).lean();
  if (!prior.length) return out;
  const used = new Set<string>();
  for (const i of fresh) {
    const l = lines[i]!;
    const twin = prior.find(
      (t) =>
        !used.has(String(t._id)) &&
        toDateInput(t.date) === l.date &&
        Math.abs((t.withdrawal ?? 0) - l.withdrawal) < 0.005 &&
        Math.abs((t.deposit ?? 0) - l.deposit) < 0.005 &&
        (l.balance !== null && typeof t.balance === "number"
          ? Math.abs(t.balance - l.balance) < 0.005
          : // Without balances to compare, the narrations must share most words or the reference must agree.
            sameText(l, t)),
    );
    if (!twin) continue;
    used.add(String(twin._id));
    // Unmatched (or cut off long ago), as against a line being added in another window right now.
    out.set(i, { action: twin.action, link: twin.link ?? null, createdAt: twin.createdAt, unmatched: !twin.link && isReopenable(twin) });
  }
  return out;
}

/**
 * How a stored line is reviewed again from its statement's page: with the occurrence its hash was
 * made with, and without looking for look-alike lines of other downloads (the line is its own).
 */
export type ReviewOptions = { occurrences?: number[]; stored?: boolean };

/** The review of every line of a statement for one account. Reads only. */
export async function reviewLines(accountId: string, lines: StatementLine[], options: ReviewOptions = {}): Promise<{ lines: ReviewLine[]; pickers: StatementPickers }> {
  const { ctx, book } = await loadContext(accountId);
  const occ = options.occurrences && options.occurrences.length === lines.length ? options.occurrences : occurrences(accountId, lines);
  const hashes = lines.map((l, i) => lineHash(accountId, l, occ[i]));

  // Lines imported from an earlier upload.
  const found = await BankTransaction.find({ account: new Types.ObjectId(accountId), hash: { $in: hashes } }, { hash: 1, action: 1, link: 1, createdAt: 1, updatedAt: 1, unmatchedAt: 1 }).lean();
  const linkInfo = await describeLinks(found.flatMap((t) => (t.link ? [{ kind: t.link.kind, id: String(t.link.id) }] : [])));
  // A line whose record was deleted since, that was unmatched, or whose add was cut off long ago, can be added again.
  const reopened = new Map<string, string>();
  for (const t of found) {
    if (t.link) {
      if (!linkInfo.has(`${t.link.kind}:${t.link.id}`)) reopened.set(t.hash, `Linked record was deleted. This line was added on ${formatDate(t.createdAt)}, but the record it became was deleted since. It can be added again.`);
    } else if (isReopenable(t)) {
      reopened.set(
        t.hash,
        "This line was unmatched from its record (or its add was cut off). It can be added again. If its record still exists, it is offered under Already recorded: pick it rather than adding the line as new.",
      );
    }
  }
  const byHash = new Map(found.filter((t) => !reopened.has(t.hash)).map((t) => [t.hash, t]));
  const fresh = lines.map((_, i) => i).filter((i) => !byHash.has(hashes[i]!));
  const lookalikes = options.stored ? new Map<number, ImportedTwin>() : await importedLookalikes(accountId, lines, fresh, hashes);
  for (const [k, v] of await describeLinks([...lookalikes.values()].flatMap((t) => (t.link ? [{ kind: t.link.kind, id: String(t.link.id) }] : [])))) linkInfo.set(k, v);
  const dates = fresh.map((i) => lines[i]!.date).sort();
  let candidates: Candidate[] = [];
  if (dates.length) {
    candidates = await loadCandidates(accountId, book, addDays(fromDateInput(dates[0]!), -MATCH_DAYS), new Date(addDays(fromDateInput(dates[dates.length - 1]!), MATCH_DAYS + 1).getTime() - 1));
    // Records already tied to one of this account's lines.
    const linked = await BankTransaction.find(
      { account: new Types.ObjectId(accountId), "link.id": { $in: candidates.map((c) => new Types.ObjectId(c.id)) } },
      { link: 1 },
    ).lean();
    const taken = new Set(linked.map((t) => `${t.link!.kind}:${t.link!.id}`));
    candidates = candidates.filter((c) => !taken.has(c.kind === "bill" ? `expense:${c.id}` : c.key));
  }

  // Every possible pair, best first; each line and each record is used once.
  const pairs: { i: number; c: Candidate; score: number }[] = [];
  for (const i of fresh) {
    for (const c of candidates) {
      const score = pairScore(lines[i]!, c);
      if (score !== null) pairs.push({ i, c, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen = new Map<number, Candidate>();
  const used = new Set<string>();
  // A bill is picked for a line only when the narration names its vendor or number. Same amount
  // alone is common (round sums), and paying the wrong bill would drop this payment's own expense
  // from the P&L; such bills stay offered, and the line is flagged instead (see sameAmountBills).
  const unnamedBill = (i: number, c: Candidate) => {
    if (c.kind !== "bill") return false;
    const n = namedIn(lines[i]!, c);
    return n.sim < 0.5 && !n.refHit;
  };
  for (const p of pairs) {
    if (chosen.has(p.i) || used.has(p.c.key) || unnamedBill(p.i, p.c)) continue;
    chosen.set(p.i, p.c);
    used.add(p.c.key);
  }
  const optionsOf = new Map<number, MatchOption[]>();
  for (const p of pairs) {
    const list = optionsOf.get(p.i) ?? [];
    if (list.length >= 5) continue;
    if (used.has(p.c.key) && chosen.get(p.i)?.key !== p.c.key) continue;
    list.push(toOption(p.c, p.score));
    optionsOf.set(p.i, list);
  }

  // Records dated before the account's opening date are history already in its opening balance (ledger.ts).
  const opening = ctx.openingDate ? toDateInput(ctx.openingDate) : null;
  const beforeOpening = (line: StatementLine): string[] =>
    opening && line.date < opening
      ? [
          `Dated before this account's opening balance date (${formatDate(ctx.openingDate!)}), so its money is already in the opening balance. A record added for it counts in the P&L, but its cash side goes to opening equity, not to this account's balance.`,
        ]
      : [];

  const out = lines.map((line, i): ReviewLine => {
    const hash = hashes[i]!;
    const base = { ...line, hash, occurrence: occ[i]! };
    const prior = byHash.get(hash);
    if (prior) {
      const info = prior.link ? linkInfo.get(`${prior.link.kind}:${prior.link.id}`) : undefined;
      return {
        ...base,
        imported: { action: prior.action as BankLineAction, on: toDateInput(prior.createdAt), label: info?.label ?? null, href: info?.href ?? null },
        candidates: [],
        suggestion: { action: prior.action as BankLineAction, paymentMethod: "bank_transfer" },
        notes: [],
        attention: false,
      };
    }
    const lineIssues = line.check === "mismatch" || line.check === "fixed" || line.issues.length > 0;
    const again = reopened.has(hash) ? [reopened.get(hash)!] : [];
    const twin = lookalikes.get(i);
    if (twin) {
      const info = twin.link ? linkInfo.get(`${twin.link.kind}:${twin.link.id}`) : undefined;
      const became = info
        ? `, and became ${info.label}`
        : twin.action === "ignore"
          ? ", and was ignored"
          : twin.link
            ? ", but the record it became was deleted since"
            : twin.unmatched
              ? ", and is not tied to any record now"
              : ", and is being added in another window right now";
      const on = toDateInput(twin.createdAt);
      // The earlier line was unmatched: its record (if it still exists) is tied again from that line, not from this copy.
      const untied = twin.unmatched;
      return {
        ...base,
        imported: null,
        candidates: [],
        suggestion: { ...suggest(line, ctx).decision, action: "ignore" },
        notes: [
          `A line with the same date, amount${line.balance !== null ? " and balance" : ""} was imported on ${on}${became}. Its narration reads differently, so this is probably the same line from another download of the statement. It is set to Ignore; change it only if it is a separate payment.`,
          ...(untied
            ? [
                "That earlier line was unmatched from its record. Review it on its statement's page (Bank statements, Past statements) to tie it to its record again. Adding this copy as a new record would record the same money twice.",
              ]
            : []),
        ],
        attention: true,
      };
    }
    const options = (optionsOf.get(i) ?? []).sort((a, b) => b.score - a.score);
    const match = chosen.get(i);
    const s = suggest(line, ctx);
    if (match) {
      const partBill = match.kind === "bill" && Math.abs(match.amount - amountOf(line)) >= 0.005;
      const notes = [
        ...(match.otherAccount ? [`${match.label} is counted in ${match.otherAccount}, since it names no account. If it was paid from this account, set its account on the record.`] : []),
        ...(partBill ? [`Part payment: ${amountOf(line).toFixed(2)} of the ${match.amount.toFixed(2)} still owed on ${match.label.replace(/^Pays /, "")}. Check it is this bill.`] : []),
      ];
      return {
        ...base,
        imported: null,
        candidates: options,
        // The suggestion stays underneath, so switching to "New ..." starts from it.
        suggestion: { ...s.decision, action: "match", matchKey: match.key },
        notes: [...again, ...notes],
        attention: lineIssues || Boolean(match.otherAccount) || partBill || again.length > 0,
      };
    }
    // An unpaid bill for the same amount whose vendor the narration does not name: offered, not picked.
    const bill = options.find((o) => o.kind === "bill" && Math.abs(o.amount - amountOf(line)) < 0.005);
    const early = beforeOpening(line);
    const billNote = bill ? [`${bill.label.replace(/^Pays /, "")} is an unpaid bill for the same amount. If this line pays it, choose Already recorded; otherwise it is a new expense.`] : [];
    return {
      ...base,
      imported: null,
      candidates: options,
      suggestion: s.decision,
      notes: [...again, ...early, ...billNote, ...s.notes],
      attention: lineIssues || s.attention || again.length > 0 || early.length > 0 || billNote.length > 0,
    };
  });
  return { lines: out, pickers: ctx.pickers };
}

export type { MatchKind };
