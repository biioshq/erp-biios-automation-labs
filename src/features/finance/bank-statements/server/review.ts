import "server-only";

import { Types } from "mongoose";
import { AccountTransfer, BankAccount, BankTransaction, CapitalEntry, EquityHolder, Expense, Income, Liability } from "@/server/models";
import { notFound } from "@/server/errors";
import { loadAccountBook, type AccountBook } from "@/server/accounts";
import { COMPANY } from "@/config/company";
import { maybeUnpaidFilter, paymentState } from "@/lib/payments";
import { OUTSTANDING_EXPR } from "@/features/finance/expenses/payment-status";
import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { invoiceBalances } from "@/server/finance/summaries";
import { INCOME_CATEGORIES, PAYMENT_METHODS, type BankLineAction, type IncomeCategory, type ProjectStage } from "@/lib/constants";
import type { LineDecision, MatchKind, MatchOption, ReviewLine, StatementLine, StatementPickers } from "../types";
import { STATEMENT_METHODS } from "../schemas";
import { analyseNarration, categoryFromWords, containsName, nameKey, nameSimilarity, namesVendor, type NarrationInfo } from "../parse/narration";
import { lineHash, occurrences } from "./hash";
import { isReopenable } from "./claims";
import { describeLinks } from "./links";
import {
  loadClientNames,
  loadOwnAccounts,
  loadPickers,
  loadProjectHistory,
  loadVendorHistory,
  type OwnAccount,
  type ProjectRef,
  type VendorHistory,
  type VendorProjects,
} from "./context";
import { findRuleHit, loadRules, type PartyRule, type RuleBook } from "./rules";
import { UNMATCHED_EXPENSE_SOURCES, placement } from "./placement";
import { MATCH_PERMISSIONS } from "../match-access";

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
/**
 * A payment recorded by hand on an expense (Mark as paid, Record payment) may be dated up to this
 * many days from its bank line, when the amount is the same to the paisa and the narration names the
 * vendor (or the payee is remembered as that vendor). People often tick a bill paid on another day.
 */
const HAND_PAYMENT_DAYS = 30;

type Side = "dr" | "cr";
/**
 * `blocked`: a record the person may not tie lines to ("kind", see match-access.ts) or may not see
 * ("salary", without data.salaries). It still takes part in pairing, so a line it most likely is
 * starts held back on Ignore instead of being suggested as a new record (the same money twice),
 * but it is never shown as an option and its name is never put in a note.
 */
type Candidate = Omit<MatchOption, "score"> & { side: Side; party: string; refs: string[]; blocked?: "kind" | "salary" };

const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY;
const sideOf = (l: StatementLine): Side => (l.withdrawal > 0 ? "dr" : "cr");
const amountOf = (l: StatementLine) => (l.withdrawal > 0 ? l.withdrawal : l.deposit);
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A payment recorded by hand on another of the company's bank accounts: a line may be that payment. */
type ElsewherePayment = { label: string; party: string; amount: number; date: string; account: string };

/** `salaries`: the person may see salaries; without it salary expenses are blocked (their vendors are the people paid). */
async function loadCandidates(accountId: string, book: AccountBook, from: Date, to: Date, elsewhere: ElsewherePayment[], salaries: boolean): Promise<Candidate[]> {
  const target = `cash:${accountId}`;
  const salaryBlock = (category: string | null | undefined) => (!salaries && category === "salaries" ? { blocked: "salary" as const } : {});
  const range = { $gte: from, $lte: to };
  // `from` and `to` already reach MATCH_DAYS past the lines; payments recorded by hand reach HAND_PAYMENT_DAYS.
  const payFrom = addDays(from, MATCH_DAYS - HAND_PAYMENT_DAYS);
  const payTo = addDays(to, HAND_PAYMENT_DAYS - MATCH_DAYS);
  const payRange = { $gte: payFrom, $lte: payTo };
  const out: Candidate[] = [];
  const add = (c: Candidate) => out.push(c);

  const [expenses, bills, incomes, loans, entries, transfers, holders, accounts] = await Promise.all([
    Expense.find(
      {
        countedAtPurchase: { $ne: true },
        // Loan interest is part of its repayment, which is offered as one line.
        source: { $nin: UNMATCHED_EXPENSE_SOURCES },
        $or: [{ date: range, payments: { $exists: false } }, { "payments.date": payRange }],
      },
      { number: 1, vendor: 1, amount: 1, date: 1, paymentMethod: 1, account: 1, payments: 1, bankTransaction: 1, gst: 1, category: 1 },
    ).lean(),
    Expense.find(
      {
        ...maybeUnpaidFilter(),
        countedAtPurchase: { $ne: true },
        // The expenses Record payment refuses (assertTakesPayments), which paying from a line refuses too.
        source: { $nin: UNMATCHED_EXPENSE_SOURCES },
        date: { $lte: to },
        // Only bills still owing money, before the limit: paid ones with a payments list would crowd them out.
        $expr: { $gt: [OUTSTANDING_EXPR, 0.005] },
      },
      { number: 1, vendor: 1, amount: 1, date: 1, dueDate: 1, paymentMethod: 1, account: 1, payments: 1, gst: 1, category: 1 },
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
      add({ key: `expense:${e._id}`, kind: "expense", id: String(e._id), label: `${e.number} · ${e.vendor}`, detail: "Expense paid on its date", href: `/finance/expenses?view=${e._id}`, amount: e.amount, date: toDateInput(e.date), side: "dr", party: e.vendor, refs, otherAccount: p.other, ...salaryBlock(e.category) });
      continue;
    }
    for (const pay of e.payments) {
      if (pay.bankTransaction || pay.date < payFrom || pay.date > payTo) continue;
      const p = placement(book, target, pay.paymentMethod, pay.account);
      if (!p.ok) {
        // Booked to another bank account (Mark as paid starts with the default one). Matching would leave
        // the money on that account, so it is not offered; the line is flagged instead (see suggest).
        const code = pay.account ? book.resolve(pay.paymentMethod ?? "bank_transfer", pay.account) : null;
        // Its note names the vendor, so a salary payment is left out for people who may not see salaries.
        if (code?.startsWith("cash:") && code !== target && !salaryBlock(e.category).blocked) {
          elsewhere.push({ label: `${e.number} · ${e.vendor}`, party: e.vendor, amount: pay.amount, date: toDateInput(pay.date), account: book.byCode.get(code)?.name ?? "another account" });
        }
        continue;
      }
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
        ...salaryBlock(e.category),
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
      ...salaryBlock(e.category),
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

/**
 * The narration names the record's party, or carries one of its numbers. `alias` is what else is
 * known about the line's party: the file's vendor column and the remembered party it stands for
 * (a payee once matched to vendor X's bill names X from then on).
 */
function namedIn(line: StatementLine, c: Candidate, alias = ""): { sim: number; whole: boolean; refHit: boolean } {
  const text = `${line.narration} ${line.reference ?? ""}`;
  const hay = alnum(text);
  const named = alias ? `${text} ${alias}` : text;
  return {
    sim: c.party ? nameSimilarity(c.party, named) : 0,
    // Every distinctive word of the vendor: one shared word ("Web", "Amazon") is not enough to pay a bill.
    whole: c.party ? namesVendor(c.party, named) : false,
    refHit: c.refs.some((r) => alnum(r).length >= 4 && hay.includes(alnum(r))),
  };
}

/** How well a record fits a line, or null when it cannot be the same payment. */
function pairScore(line: StatementLine, c: Candidate, alias = ""): number | null {
  if (c.side !== sideOf(line)) return null;
  // Part of an unpaid bill: a line for less than what is still owed, when the narration names the vendor.
  const part = c.kind === "bill" && amountOf(line) < c.amount - 0.005;
  if (!part && Math.abs(c.amount - amountOf(line)) >= 0.005) return null;
  const days = dayNumber(line.date) - dayNumber(c.date);
  const { sim, whole, refHit } = namedIn(line, c, alias);
  if (c.kind === "bill") {
    // A bill is paid on or after its date; long after only when the narration names the vendor.
    if (days < -MATCH_DAYS) return null;
    // Part of a bill only when the line names the whole vendor or the bill's number.
    if (part) return whole || refHit ? 20 + sim * 40 + (refHit ? 30 : 0) - Math.min(Math.abs(days), 30) : null;
    if (!whole && !refHit && days > 30) return null;
    return 40 + sim * 40 + (refHit ? 30 : 0) - Math.min(Math.abs(days), 30);
  }
  if (Math.abs(days) > MATCH_DAYS) {
    // A payment ticked by hand on another day: the same amount, and the narration (or the remembered party) names the vendor.
    // Kept below any named bill (at least 30), so this month's outstanding bill wins over last month's hand payment.
    if (c.kind !== "expensePayment" || Math.abs(days) > HAND_PAYMENT_DAYS || !whole) return null;
    return 10 + sim * 15 - Math.abs(days) / 3 - (c.otherAccount ? 5 : 0);
  }
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
  rules: RuleBook;
  /** The rule found for each line, so a line is looked up once per review. */
  ruleCache: WeakMap<StatementLine, PartyRule | null>;
  projects: ProjectRef[];
  vendorProjects: Map<string, VendorProjects>;
  /** Each project's most used stage in recent expenses. */
  projectStage: Map<string, string>;
  /** Customer invoices with money still owed on them. */
  invoices: { id: string; number: string; client: string; project: string | null; total: number; outstanding: number }[];
  /** Hand payments on the company's other bank accounts, filled with the match candidates. */
  elsewhere: ElsewherePayment[];
  /** The person may see and add salaries (data.salaries). */
  salaries: boolean;
};

/** A category the line may be suggested: one of the pickers, and Salaries only for people who may add salary expenses. */
const allowedCategory = (ctx: Context, value: string | null | undefined) =>
  value && (ctx.salaries || value !== "salaries") && ctx.pickers.categories.some((c) => c.value === value) ? value : null;

/**
 * The remembered party of a line, looked up once per line. A rule found only by its name inside
 * the narration gives way to a longer vendor or client name of the books found there too: a rule
 * for "Amazon" does not speak for "AMAZON WEB SERVICES" when Amazon Web Services is a vendor.
 */
function ruleFor(ctx: Context, line: StatementLine, info: NarrationInfo): PartyRule | null {
  if (ctx.ruleCache.has(line)) return ctx.ruleCache.get(line) ?? null;
  const out = sideOf(line) === "dr";
  const hit = findRuleHit(ctx.rules, out ? "out" : "in", line, info);
  let rule = hit?.rule ?? null;
  if (hit?.by === "name") {
    const text = `${line.narration} ${line.vendor ?? ""}`;
    const known = knownName(out ? ctx.vendors.map((v) => v.name) : ctx.clients, text);
    if (known && nameKey(known).replace(/ /g, "").length > nameKey(hit.rule.party).replace(/ /g, "").length) rule = null;
  }
  ctx.ruleCache.set(line, rule);
  return rule;
}

const vendorKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Projects that still take expenses and suggestions: not completed, not cancelled. */
const OPEN_PROJECT = new Set(["planning", "active", "on_hold"]);
const openProject = (ctx: Context, id: string | null | undefined) => (id ? ctx.projects.find((p) => p.id === id && OPEN_PROJECT.has(p.status)) : undefined);

/** A vendor's recent expenses point at one project when at least this many, and this share of all of them, went to it. */
const DOMINANT_MIN = 2;
const DOMINANT_SHARE = 0.6;

/** Narration words that read like buying equipment or another asset that lasts. */
const ASSET_RE =
  /\blaptops?\b|\bmacbook|\bcomputers?\b|\bdesktop\b|\bmonitors?\b|\bprinters?\b|\b3d ?print|\bmachine(ry|s)?\b|\bequipment\b|\bfurniture\b|\boscilloscope|\bmultimeter|\bsoldering\b|\bcnc\b|\blathe\b|\bgenerator\b|\binverter\b|\bair ?condition|\bvehicle\b|\bcamera\b|\bcapital goods?\b|\bfixed asset/i;

/**
 * The file's own category for the line, matched to the category values or names (any case):
 * expense categories for withdrawals, income categories for deposits. `unknown` is a value that
 * matches none, which leaves the suggestion as it is.
 */
function columnCategory(ctx: Context, line: StatementLine): { value: string } | { unknown: string } | null {
  const raw = line.category?.trim();
  if (!raw) return null;
  const k = nameKey(raw);
  const list = sideOf(line) === "dr" ? ctx.pickers.categories : INCOME_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));
  const hit = list.find((c) => nameKey(c.value) === k || nameKey(c.label) === k);
  return hit ? { value: hit.value } : { unknown: raw.slice(0, 60) };
}

type ProjectPick = { projectId?: string; stage?: ProjectStage; note: string };

/**
 * The project an expense line most likely belongs to: the one remembered for its party, else the
 * vendor's project in most of its recent expenses, else a project whose code or name is in the
 * narration. Never a completed or cancelled project. An expense needs a stage with its project, so
 * a project without a known stage is only named in a note.
 */
function suggestProject(ctx: Context, line: StatementLine, party: string | null, rule: PartyRule | null): ProjectPick | null {
  const remembered = openProject(ctx, rule?.projectId);
  if (remembered && rule?.stage) return { projectId: remembered.id, stage: rule.stage, note: `Project ${remembered.name} remembered from your earlier choice.` };

  const history = party ? ctx.vendorProjects.get(vendorKey(party)) : undefined;
  if (history && history.total > 0) {
    const top = [...history.projects.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    const project = top ? openProject(ctx, top[0]) : undefined;
    if (top && project && top[1].count >= DOMINANT_MIN && top[1].count / history.total >= DOMINANT_SHARE) {
      const stage = [...top[1].stages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as ProjectStage | undefined;
      const why = `${top[1].count} of the ${history.total} expenses with ${party} in the last 180 days were for ${project.name}`;
      return stage ? { projectId: project.id, stage, note: `Project suggested: ${why}.` } : { note: `${why}. Set the project and stage if this one is too.` };
    }
  }

  const hay = ` ${nameKey(line.narration)} `;
  const flat = alnum(line.narration);
  const named = ctx.projects.find(
    (p) => OPEN_PROJECT.has(p.status) && ((alnum(p.code).length >= 5 && flat.includes(alnum(p.code))) || (nameKey(p.name).replace(/ /g, "").length >= 6 && containsName(p.name, hay))),
  );
  if (named) {
    const stage = ctx.projectStage.get(named.id) as ProjectStage | undefined;
    return stage
      ? { projectId: named.id, stage, note: `The narration names project ${named.code} ${named.name}. Stage taken from its recent expenses; check it.` }
      : { note: `The narration names project ${named.code} ${named.name}. Set it and the stage if this expense belongs to it.` };
  }
  return null;
}

/** An open customer invoice the deposit pays: its number is in the narration, or its client is named and the amount is what it owes (or its total). */
function openInvoiceFor(ctx: Context, line: StatementLine): Context["invoices"][number] | null {
  const amount = line.deposit;
  const hay = alnum(`${line.narration} ${line.reference ?? ""}`);
  const text = `${line.narration} ${line.vendor ?? ""}`;
  let best: { inv: Context["invoices"][number]; score: number } | null = null;
  for (const inv of ctx.invoices) {
    const refHit = alnum(inv.number).length >= 4 && hay.includes(alnum(inv.number)) && amount <= inv.outstanding + 0.005;
    const exact = Math.abs(inv.outstanding - amount) < 0.005 || Math.abs(inv.total - amount) < 0.005;
    const score = refHit ? 2 : exact && containsName(inv.client, text) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { inv, score };
  }
  return best?.inv ?? null;
}

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

/** The group companies money passes through (the "Biios Startup LLP" payment method): related, not customers or vendors. */
const GROUP_COMPANIES: string[] = PAYMENT_METHODS.filter((m) => m.value === "biios_startup_llp").map((m) => m.label);
const groupCompanyIn = (party: string | null | undefined, narration: string) => GROUP_COMPANIES.find((g) => namesVendor(g, `${party ?? ""} ${narration}`)) ?? null;

/** What an unmatched line most likely is, with notes for what the admin should check. */
function suggest(
  line: StatementLine,
  ctx: Context,
): { decision: LineDecision; notes: string[]; attention: boolean; invoice?: ReviewLine["invoice"]; holdBack?: string; group?: string | null } {
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
    // Who it was paid to: the file's vendor column, else a remembered party, else a vendor in the books, else the narration's payee.
    const rule = ruleFor(ctx, line, info);
    const known = knownName(ctx.vendors.map((v) => v.name), line.narration);
    const party = line.vendor ?? rule?.party ?? known ?? info.payee;
    const history = party ? ctx.vendorByKey.get(vendorKey(party)) : undefined;
    const column = columnCategory(ctx, line);
    if (column && "unknown" in column) notes.push(`The file's category "${column.unknown}" is not one of your expense categories, so the suggestion is kept. Change it if needed.`);
    // Pay that this person may not add as Salaries is held back rather than booked under another category.
    let salaryHold = false;
    if (column && "value" in column && column.value === "salaries" && !ctx.salaries) {
      notes.push("The file's category is Salaries, which your role cannot add, so another category is shown. Ask someone who may record salaries to add this line if it is pay.");
      salaryHold = true;
    } else if (info.kind === "salary" && !ctx.salaries) {
      notes.push("Looks like a salary payment, which your role cannot add, so another category is shown. Ask someone who may record salaries to add this line if it is pay.");
      salaryHold = true;
    }
    if (salaryHold) attention = true;
    // Remembered parties first, then the vendor's earlier expenses, then the narration's words.
    const fromColumn = column && "value" in column ? allowedCategory(ctx, column.value) : null;
    // Other is where a line nothing recognised goes: a remembered or earlier Other is not a category anyone picked.
    const picked = (v: string | null | undefined) => (v === "other" ? null : v);
    const fromRule = allowedCategory(ctx, picked(rule?.category));
    const fromSalary = info.kind === "salary" ? allowedCategory(ctx, "salaries") : null;
    const fromHistory = allowedCategory(ctx, picked(history?.category));
    const fromWords = allowedCategory(ctx, categoryFromWords(line.narration));
    const category = fromColumn ?? fromRule ?? fromSalary ?? fromHistory ?? fromWords ?? allowedCategory(ctx, "other") ?? ctx.pickers.categories.find((c) => allowedCategory(ctx, c.value))?.value;
    if (rule) notes.push(`Remembered from your earlier choice: ${rule.party}${fromRule && !fromColumn ? `, ${ctx.pickers.categories.find((c) => c.value === fromRule)?.label ?? fromRule}` : ""}.`);
    if (fromColumn) notes.push("Category from the file's category column.");
    else if (!fromRule && !fromSalary && fromHistory && history) notes.push(`Category from ${history.count === 1 ? "an earlier expense" : `${history.count} earlier expenses`} with ${history.name}.`);
    else if (!fromRule && !fromSalary && !fromHistory && !fromWords) {
      notes.push(
        rule || history
          ? "No category has been picked for this payee yet (only Other), so it is set to Other. Pick the right category."
          : "No remembered party, earlier expense or keyword gives this payment a category, so it is set to Other. Pick the right category.",
      );
      attention = true;
    }
    if (!party) {
      notes.push(info.handle ? `The narration shows only the UPI handle ${info.handle}, not a name. Check the vendor.` : "The narration has no payee name. Check the vendor.");
      attention = true;
    }
    const owner = party ? ctx.holders.find((h) => h.kind === "owner" && containsName(h.name, line.narration)) : undefined;
    if (owner) notes.push(`Paid to ${owner.name}, an owner. If it was a drawing, choose Owner drawing.`);
    const group = groupCompanyIn(party, line.narration);
    if (group) {
      notes.unshift(`Paid to ${group}, your group company. If it was a loan to them, a repayment or a transfer rather than a cost of this company, choose that instead.`);
      attention = true;
    }
    const project = suggestProject(ctx, line, party, rule);
    if (project) notes.push(project.note);
    if (category === "equipment" || ASSET_RE.test(line.narration)) {
      notes.push("Could be a fixed asset. Once it is added, you can put it on the asset register from the results.");
    }
    const recordedElsewhere = ctx.elsewhere.find(
      (p) =>
        Math.abs(p.amount - line.withdrawal) < 0.005 &&
        Math.abs(dayNumber(p.date) - dayNumber(line.date)) <= HAND_PAYMENT_DAYS &&
        namesVendor(p.party, `${party ?? ""} ${line.narration}`),
    );
    if (recordedElsewhere) {
      // First, so it is the note the review table shows on the line.
      notes.unshift(
        `Maybe already recorded: ${recordedElsewhere.label} was marked paid from ${recordedElsewhere.account} on ${formatDate(fromDateInput(recordedElsewhere.date))}. If this line is that payment, change that payment's account to this one and review the statement again, instead of adding a new expense.`,
      );
      attention = true;
    }
    return {
      decision: decide("expense", { party: party ?? info.handle ?? cleanNarration(line.narration), category, holderId: owner?.id, projectId: project?.projectId, stage: project?.stage }),
      notes,
      attention,
      holdBack: recordedElsewhere ? "It may already be recorded as a payment from another account." : salaryHold ? "It looks like a salary payment, which your role cannot add." : undefined,
      group,
    };
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
    const lender = info.payee ?? info.handle ?? cleanNarration(line.narration);
    notes.push("Looks like a loan paid out to you. Pick the group it belongs to.");
    return { decision: decide("loan_received", { party: lender, loanName: `Loan from ${lender}`.slice(0, 160) }), notes, attention: true };
  }
  if (info.kind === "refund") {
    notes.push("Looks like a refund or reversal. If it reverses a withdrawal, choose Ignore, or match it, instead of income.");
    attention = true;
  }
  // Income is pre-ticked only when the payer is a known customer, a remembered party, or the line pays an open invoice.
  const rule = ruleFor(ctx, line, info);
  const known = (line.vendor ? knownName(ctx.clients, line.vendor) : null) ?? knownName(ctx.clients, line.narration);
  const invoice = openInvoiceFor(ctx, line);
  const party = line.vendor ?? rule?.party ?? invoice?.client ?? known ?? info.payee;
  const column = columnCategory(ctx, line);
  if (column && "unknown" in column) notes.push(`The file's category "${column.unknown}" is not one of the income categories, so the suggestion is kept. Change it if needed.`);
  const isIncomeCategory = (v: string | null | undefined): v is IncomeCategory => Boolean(v && INCOME_CATEGORIES.some((c) => c.value === v));
  const fromColumn = column && "value" in column && isIncomeCategory(column.value) ? column.value : null;
  const fromRule = isIncomeCategory(rule?.category) ? rule.category : null;
  // A payer remembered only under Other was the default for an unknown payer, not a customer someone picked.
  const unknownPayer = !known && !invoice && (!rule || rule.category === "other");
  // A payer that is not a known customer is not assumed to pay for a project: its income goes under Other.
  const incomeCategory: IncomeCategory = fromColumn ?? fromRule ?? (unknownPayer ? "other" : "project_payment");
  if (rule) notes.push(`Remembered from your earlier choice: ${rule.party}.`);
  if (fromColumn) notes.push("Category from the file's category column.");
  const group = groupCompanyIn(party, line.narration);
  if (group) {
    notes.unshift(`From ${group}, your group company. Money between group companies is often a loan, a repayment or a transfer rather than income: if so, choose Loan received or Capital introduced instead.`);
    attention = true;
  } else if (unknownPayer) {
    notes.push(
      `The payer is not a known customer, so this is income under ${fromColumn || fromRule ? "the category shown" : "Other"}. If it pays for a sale or a service, pick the category; if it is capital, a loan or a transfer from your own account, choose that instead.`,
    );
    attention = true;
  }
  if (!party) {
    notes.push(info.handle ? `The narration shows only the UPI handle ${info.handle}, not a name. Check the client.` : "The narration has no payer name. Check the client.");
    attention = true;
  }
  const projectId = openProject(ctx, rule?.projectId)?.id ?? openProject(ctx, invoice?.project)?.id;
  // The receipt is linked to the invoice on adding only where the invoice receipt rules allow it: the same client or project.
  const linkable = Boolean(
    invoice && ((party && party.trim().toLowerCase() === invoice.client.trim().toLowerCase()) || (invoice.project && projectId === invoice.project)),
  );
  if (invoice) {
    const about = `Looks like a payment of invoice ${invoice.number} (${invoice.client}, ${invoice.outstanding.toFixed(2)} still owed).`;
    notes.push(
      linkable
        ? `${about} The new income is linked to that invoice, so the invoice shows as paid. Untick the link in the line's details if it pays something else.`
        : `${about} The payer here is ${party}, so the receipt is not linked to it. Link it from the income record if it pays that invoice.`,
    );
    if (!linkable) attention = true;
  }
  return {
    decision: decide("income", { party: party ?? info.handle ?? cleanNarration(line.narration), incomeCategory, projectId, invoiceId: linkable ? invoice!.id : undefined }),
    notes,
    attention,
    invoice: invoice ? { id: invoice.id, number: invoice.number, client: invoice.client, outstanding: invoice.outstanding } : null,
    group,
  };
}

async function loadContext(accountId: string, salaries: boolean): Promise<{ ctx: Context; book: AccountBook }> {
  const account = await BankAccount.findById(accountId, { name: 1, bankName: 1, openingDate: 1 }).lean();
  if (!account) throw notFound("The bank account");
  const [book, own, history, clients, pickers, holders, loans, rules, projectHistory, receivables] = await Promise.all([
    loadAccountBook(),
    loadOwnAccounts(),
    loadVendorHistory(salaries),
    loadClientNames(),
    loadPickers(),
    EquityHolder.find({ archivedAt: null }, { name: 1, kind: 1 }).lean(),
    Liability.find({ archivedAt: null }, { name: 1, lender: 1, installment: 1 }).lean(),
    loadRules(salaries),
    loadProjectHistory(salaries),
    invoiceBalances(),
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
      rules,
      ruleCache: new WeakMap(),
      projects: projectHistory.projects,
      vendorProjects: projectHistory.byVendor,
      projectStage: projectHistory.stageOf,
      invoices: receivables
        .filter((r) => r.outstanding > 0)
        .map((r) => ({ id: r.id, number: r.number, client: r.client, project: r.project, total: r.total, outstanding: r.outstanding })),
      elsewhere: [],
      salaries,
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
/**
 * `matchKinds`: the kinds of "Already recorded" the person may add (match-access.ts); other records
 * are not offered. `salaries`: the person may see salaries (data.salaries); without it, salary expenses,
 * remembered salary payees and the salary category are left out of the suggestions, as the
 * Remembered parties and Expenses pages leave them out. The review actions always pass both; an
 * internal caller that leaves them out gets everything.
 */
export type ReviewOptions = { occurrences?: number[]; stored?: boolean; matchKinds?: ReadonlySet<MatchKind>; salaries?: boolean };

/** The review of every line of a statement for one account. Reads only. */
export async function reviewLines(accountId: string, lines: StatementLine[], options: ReviewOptions = {}): Promise<{ lines: ReviewLine[]; pickers: StatementPickers }> {
  const { ctx, book } = await loadContext(accountId, options.salaries ?? true);
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
    candidates = await loadCandidates(accountId, book, addDays(fromDateInput(dates[0]!), -MATCH_DAYS), new Date(addDays(fromDateInput(dates[dates.length - 1]!), MATCH_DAYS + 1).getTime() - 1), ctx.elsewhere, ctx.salaries);
    // Records already tied to one of this account's lines.
    const linked = await BankTransaction.find(
      { account: new Types.ObjectId(accountId), "link.id": { $in: candidates.map((c) => new Types.ObjectId(c.id)) } },
      { link: 1 },
    ).lean();
    const taken = new Set(linked.map((t) => `${t.link!.kind}:${t.link!.id}`));
    const allowed = options.matchKinds;
    candidates = candidates
      .filter((c) => !taken.has(c.kind === "bill" ? `expense:${c.id}` : c.key))
      .map((c) => (!c.blocked && allowed && !allowed.has(c.kind) ? { ...c, blocked: "kind" as const } : c));
  }

  // What each line's narration says, and who else is known to be its party (the file's vendor column, a remembered party).
  const infos: NarrationInfo[] = lines.map((l) => analyseNarration(l.narration, sideOf(l), { exclude: [COMPANY.name] }));
  const remembered = new Map<number, PartyRule>();
  for (const i of fresh) {
    const rule = ruleFor(ctx, lines[i]!, infos[i]!);
    if (rule) remembered.set(i, rule);
  }
  const aliasOf = (i: number) => [lines[i]!.vendor, remembered.get(i)?.party].filter(Boolean).join(" ");

  // Every possible pair, best first; each line and each record is used once.
  const pairs: { i: number; c: Candidate; score: number }[] = [];
  /** Lines with an unpaid bill of the same amount that the person may not pay or see: held back like an offered one. */
  const blockedBill = new Set<number>();
  for (const i of fresh) {
    const alias = aliasOf(i);
    for (const c of candidates) {
      const score = pairScore(lines[i]!, c, alias);
      if (score === null) continue;
      pairs.push({ i, c, score });
      if (c.blocked && c.kind === "bill" && Math.abs(c.amount - amountOf(lines[i]!)) < 0.005) blockedBill.add(i);
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen = new Map<number, Candidate>();
  const used = new Set<string>();
  // A bill is picked for a line only when the narration names its vendor or number. Same amount
  // alone is common (round sums), and paying the wrong bill would drop this payment's own expense
  // from the P&L; such bills stay offered, and the line is flagged instead (see sameAmountBills).
  // A payee remembered as the bill's vendor (from an earlier match) names it too.
  const unnamedBill = (i: number, c: Candidate) => {
    if (c.kind !== "bill") return false;
    const n = namedIn(lines[i]!, c, aliasOf(i));
    return !n.whole && !n.refHit;
  };
  /** The vendor was not in the narration itself, only in the file's vendor column or the remembered party. */
  const namedByAliasOnly = (i: number, c: Candidate) => {
    const plain = namedIn(lines[i]!, c);
    return !plain.whole && !plain.refHit;
  };
  for (const p of pairs) {
    if (chosen.has(p.i) || used.has(p.c.key) || unnamedBill(p.i, p.c)) continue;
    chosen.set(p.i, p.c);
    used.add(p.c.key);
  }
  const optionsOf = new Map<number, MatchOption[]>();
  for (const p of pairs) {
    const list = optionsOf.get(p.i) ?? [];
    if (list.length >= 5 || p.c.blocked) continue;
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
    const base = { ...line, hash, occurrence: occ[i]!, narrationKind: infos[i]!.kind };
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
    if (match?.blocked) {
      // Most likely a record already in the books that this person may not tie the line to: held back, so the money is not recorded twice.
      const why =
        match.blocked === "salary"
          ? "This line looks already recorded, in a record your role cannot see."
          : `This line looks already recorded, but your role cannot add ${MATCH_PERMISSIONS[match.kind].what}.`;
      return {
        ...base,
        imported: null,
        candidates: options,
        invoice: s.invoice ?? null,
        suggestion: { ...s.decision, action: "ignore" },
        notes: [...again, `${why} It is set to Ignore and left unticked so the money is not recorded twice. Ask someone who may tie it to add this line.`],
        attention: true,
        holdBack: "It may already be recorded in a record your role cannot tie this line to.",
        group: s.group ?? null,
      };
    }
    if (match) {
      const partBill = match.kind === "bill" && Math.abs(match.amount - amountOf(line)) >= 0.005;
      const gap = Math.abs(dayNumber(line.date) - dayNumber(match.date));
      const farPayment = match.kind === "expensePayment" && gap > MATCH_DAYS;
      const notes = [
        ...(farPayment
          ? [
              `Already recorded: ${match.label.replace(/^Payment on /, "")} has a payment of the same amount recorded by hand on ${formatDate(match.date)}, ${gap} days from this line. Tie the line to it rather than adding a new expense, unless it is a separate payment.`,
            ]
          : []),
        ...(match.otherAccount ? [`${match.label} is counted in ${match.otherAccount}, since it names no account. If it was paid from this account, set its account on the record.`] : []),
        ...(partBill ? [`Part payment: ${amountOf(line).toFixed(2)} of the ${match.amount.toFixed(2)} still owed on ${match.label.replace(/^Pays /, "")}. Check it is this bill.`] : []),
        ...(match.kind === "bill"
          ? [
              `Paid as shown on the statement: settles the outstanding payment ${match.label.replace(/^Pays /, "")}, marked paid on ${formatDate(line.date)} from this account. No new expense is made.`,
              ...(namedByAliasOnly(i, match)
                ? [remembered.has(i) ? `The vendor is remembered from your earlier choice (${remembered.get(i)!.party}).` : "The vendor is named in the file's vendor column."]
                : []),
            ]
          : []),
      ];
      return {
        ...base,
        imported: null,
        candidates: options,
        invoice: s.invoice ?? null,
        // The suggestion stays underneath, so switching to "New ..." starts from it.
        suggestion: { ...s.decision, action: "match", matchKey: match.key },
        notes: [...again, ...notes],
        attention: lineIssues || Boolean(match.otherAccount) || partBill || farPayment || again.length > 0,
        holdBack: line.check === "mismatch" ? "Its amount does not agree with the running balance." : null,
        group: s.group ?? null,
      };
    }
    // An unpaid bill for the same amount whose vendor the narration does not name: offered, not picked.
    const bill = options.find((o) => o.kind === "bill" && Math.abs(o.amount - amountOf(line)) < 0.005);
    const early = beforeOpening(line);
    const billNote = bill
      ? [`${bill.label.replace(/^Pays /, "")} is an unpaid bill for the same amount. If this line pays it, choose Already recorded; otherwise it is a new expense.`]
      : blockedBill.has(i)
        ? ["An unpaid bill your role cannot pay from here has the same amount. If this line pays it, ask someone who may pay it to add this line; otherwise it is a new expense."]
        : [];
    return {
      ...base,
      imported: null,
      candidates: options,
      invoice: s.invoice ?? null,
      suggestion: s.decision,
      notes: [...again, ...early, ...billNote, ...s.notes],
      attention: lineIssues || s.attention || again.length > 0 || early.length > 0 || billNote.length > 0,
      // These start unticked, for a person to check: adding them as new could record the same money twice.
      holdBack: billNote.length
        ? "An unpaid bill has the same amount."
        : (s.holdBack ?? (line.check === "mismatch" ? "Its amount does not agree with the running balance." : null)),
      group: s.group ?? null,
    };
  });
  return { lines: out, pickers: ctx.pickers };
}

export type { MatchKind };
