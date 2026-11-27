import "server-only";

import { Types } from "mongoose";
import { AccountTransfer, BankAccount, BankStatement, BankTransaction, CapitalEntry, Expense, Income, Liability, Project } from "@/server/models";
import { AppError, isDuplicateKeyError, notFound } from "@/server/errors";
import { requireIndexes } from "@/server/new-indexes";
import { nextNumber } from "@/server/services/numbering";
import { assertExpenseCategoryAllowed } from "@/server/expense-categories";
import { createCapitalEntry } from "@/features/finance/equity/server";
import { addLiabilityPayment, createLiability } from "@/features/finance/liabilities/server";
import { createAccountTransfer } from "@/features/finance/assets/accounts/server";
import { paymentState } from "@/lib/payments";
import { addDays, endOfDayIST, fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { AddLineResult, AddBatchResult } from "../types";
import type { AddLineValues, AddLinesValues } from "../schemas";
import { lineHash } from "./hash";
import { reopenableFilter } from "./claims";
import { describeLinks, linkExists, type LinkRef } from "./links";
import { learnFromLine } from "./rules";
import { confirmReceiptLink, invoiceForReceipt } from "./invoice-link";
import { analyseNarration } from "../parse/narration";
import { lineKindOf, type BankLineKind } from "../kinds";
import { COMPANY } from "@/config/company";
import { auditStatementLines } from "@/features/finance/audit/bank";
import { assertTakesPayments } from "@/features/finance/expenses/payment-core";
import { salaryRefused } from "@/features/finance/expenses/server";
import { loadAccountBook, type AccountBook } from "@/server/accounts";
import { UNMATCHED_EXPENSE_SOURCES, placement } from "./placement";

/**
 * Adds reviewed statement lines to the books, one line at a time so one bad line never stops the
 * rest. Every line first claims its BankTransaction (unique per account and line hash): a second
 * click, a second tab or a second upload of the same statement finds the claim and adds nothing.
 * The record a line becomes stores the claim's id, so a line interrupted half way (a timeout after
 * the record was saved) is finished on the next try instead of being added twice. All of this rests
 * on the unique index, so nothing is added until that index is confirmed (requireIndexes).
 */

const MATCH_DAYS = 3;

const oid = (id: string) => new Types.ObjectId(id);

/** What a reopened line held before this add, put back if the add fails. */
type Prior = {
  action: string;
  statement?: Types.ObjectId | null;
  link?: { kind: string; id: Types.ObjectId } | null;
  updatedAt?: Date | null;
  /** The unmatch marker the line carried, cleared by the claim and put back if the add fails. */
  unmatchedAt?: Date | null;
  unmatchedBy?: Types.ObjectId | null;
};
type Claim = { id: Types.ObjectId; fresh: true } | { id: Types.ObjectId; fresh: false; prior: Prior };
/**
 * `notes`: a follow-up for the results screen per claimed line (such as the invoice a receipt was linked to).
 * `salaryRecords`: the person may pay salary bills and tie lines to salary expenses (data.salaries).
 * `book`: where records keep their money, read once per batch when a line is tied to a record.
 */
type Ctx = {
  accountId: string;
  statementId: () => Promise<Types.ObjectId>;
  userId: string;
  salaries: boolean;
  salaryRecords: boolean;
  notes: Map<string, string>;
  book: () => Promise<AccountBook>;
};

const amountOf = (l: AddLineValues) => (l.withdrawal > 0 ? l.withdrawal : l.deposit);
const isOut = (l: AddLineValues) => l.withdrawal > 0;

/** The line's type, worked out here from its narration and action (never taken from the browser). */
function kindOf(l: AddLineValues): BankLineKind {
  const side = isOut(l) ? "dr" : "cr";
  return lineKindOf(side, analyseNarration(l.narration, side, { exclude: [COMPANY.name] }).kind, l.decision.action, l.decision.matchKey);
}

/** Where the line sat in the uploaded file. A line reviewed again from its statement's page has no row (0). */
const placeOf = (l: AddLineValues) => ({ ...(l.line > 0 ? { row: l.line } : {}), ...(l.page !== undefined && l.page >= 0 ? { page: l.page } : {}) });

function statementNote(l: AddLineValues): string {
  return [`From the bank statement: ${l.narration}`, l.reference ? `Reference: ${l.reference}` : null].filter(Boolean).join("\n").slice(0, 4000);
}

/** The record already holding this claim (a retry after an interruption), as a link. */
async function recordHolding(txn: Types.ObjectId): Promise<LinkRef | null> {
  const loan = await Liability.findOne({ "payments.bankTransaction": txn }, { payments: 1 }).lean();
  const pay = loan?.payments?.find((p) => p.bankTransaction && String(p.bankTransaction) === String(txn));
  if (pay) return { kind: "liabilityPayment", id: String(pay._id) };
  const [taken, expensePaid, expense, income, entry, transfer] = await Promise.all([
    Liability.findOne({ bankTransaction: txn }, { _id: 1 }).lean(),
    Expense.findOne({ "payments.bankTransaction": txn }, { payments: 1 }).lean(),
    Expense.findOne({ bankTransaction: txn, source: { $ne: "liability_interest" } }, { _id: 1 }).lean(),
    Income.findOne({ bankTransaction: txn }, { _id: 1 }).lean(),
    CapitalEntry.findOne({ bankTransaction: txn }, { _id: 1 }).lean(),
    AccountTransfer.findOne({ bankTransactions: txn }, { _id: 1 }).lean(),
  ]);
  if (taken) return { kind: "liability", id: String(taken._id) };
  const ep = expensePaid?.payments?.find((p) => p.bankTransaction && String(p.bankTransaction) === String(txn));
  if (ep) return { kind: "expensePayment", id: String(ep._id) };
  if (expense) return { kind: "expense", id: String(expense._id) };
  if (income) return { kind: "income", id: String(income._id) };
  if (entry) return { kind: "capitalEntry", id: String(entry._id) };
  if (transfer) return { kind: "accountTransfer", id: String(transfer._id) };
  return null;
}

/**
 * Files a reopened line under this add's statement. Called only after the guarded update won the
 * line, so a request that loses the race (a double click, a second tab) makes no empty statement.
 */
async function fileUnder(claim: Claim & { fresh: false }, ctx: Ctx): Promise<Claim> {
  try {
    await BankTransaction.updateOne({ _id: claim.id }, { $set: { statement: await ctx.statementId() } });
  } catch (error) {
    // The line goes back to what it held, so it stays reviewable.
    await releaseClaim(claim).catch((e: unknown) => console.error("[bank-statements] could not release a claim", e));
    throw error;
  }
  return claim;
}

/** What a stored line holds before an add reopens it. */
function priorOf(t: {
  action: string;
  statement?: Types.ObjectId | null;
  link?: { kind: string; id: Types.ObjectId } | null;
  updatedAt?: Date | null;
  unmatchedAt?: Date | null;
  unmatchedBy?: Types.ObjectId | null;
}): Prior {
  return {
    action: t.action,
    statement: t.statement ?? null,
    link: t.link ?? null,
    updatedAt: t.updatedAt ?? null,
    unmatchedAt: t.unmatchedAt ?? null,
    unmatchedBy: t.unmatchedBy ?? null,
  };
}

/** Claims the line for this account, or says why it is already taken. */
async function claimLine(l: AddLineValues, hash: string, ctx: Ctx): Promise<Claim | { taken: string; link: LinkRef | null }> {
  const fields = {
    account: oid(ctx.accountId),
    hash,
    date: fromDateInput(l.date),
    narration: l.narration.slice(0, 1000),
    reference: l.reference,
    withdrawal: round2(l.withdrawal),
    deposit: round2(l.deposit),
    balance: l.balance ?? undefined,
    action: l.decision.action,
    kind: kindOf(l),
    ...placeOf(l),
    createdBy: Types.ObjectId.isValid(ctx.userId) ? oid(ctx.userId) : undefined,
  };
  try {
    const created = await BankTransaction.create(fields);
    // Set after the claim holds, so a statement whose lines were all imported before makes no statement record.
    await BankTransaction.updateOne({ _id: created._id }, { $set: { statement: await ctx.statementId() } });
    return { id: created._id, fresh: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const existing = await BankTransaction.findOne({ account: fields.account, hash }).lean();
  if (!existing) throw new AppError("This line was being added at the same moment. Upload the statement again to check it.", "conflict");
  // The record this line became was deleted since: the line is free to be added again.
  if (existing.link && !(await linkExists({ kind: existing.link.kind, id: String(existing.link.id) }))) {
    const reopened = await BankTransaction.findOneAndUpdate(
      { _id: existing._id, "link.id": existing.link.id },
      { $unset: { link: 1, unmatchedAt: 1, unmatchedBy: 1 }, $set: { action: l.decision.action } },
      { returnDocument: "after" },
    ).lean();
    if (!reopened) return { taken: "This line is being added in another window. Wait a minute and upload again", link: null };
    return fileUnder({ id: reopened._id, fresh: false, prior: priorOf(existing) }, ctx);
  }
  if (existing.link || existing.action === "ignore") {
    return { taken: existing.action === "ignore" ? "Already imported and ignored" : "Already imported", link: existing.link ? { kind: existing.link.kind, id: String(existing.link.id) } : null };
  }
  // An interrupted line: finish it, unless another request is working on it right now.
  const held = await recordHolding(existing._id);
  if (held) {
    await BankTransaction.updateOne({ _id: existing._id, link: { $exists: false } }, { $set: { link: { kind: held.kind, id: oid(held.id) } } });
    return { taken: "Already imported", link: held };
  }
  // Unmatched, or cut off long ago. The marker is cleared and the time set to now in the same
  // write, so a second request working on this line at the same moment no longer matches.
  const reclaimed = await BankTransaction.findOneAndUpdate(
    { _id: existing._id, link: { $exists: false }, ...reopenableFilter() },
    { $set: { action: l.decision.action }, $unset: { unmatchedAt: 1, unmatchedBy: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!reclaimed) return { taken: "This line is being added in another window. Wait a minute and upload again", link: null };
  return fileUnder({ id: reclaimed._id, fresh: false, prior: { ...priorOf(existing), link: null } }, ctx);
}

/** Exactly the record's amount, or the line is not that record. */
function assertSameAmount(recordAmount: number, l: AddLineValues) {
  if (Math.abs(round2(recordAmount) - amountOf(l)) >= 0.005) {
    throw new AppError(`That record is for ${round2(recordAmount).toFixed(2)}, not ${amountOf(l).toFixed(2)}. Pick another match.`, "invalid");
  }
}

const alreadyLinked = () => new AppError("That record is already tied to another statement line. Pick another match or add the line as new.", "conflict");

/**
 * The guarded link write matched nothing: another line tied the record between the read and the
 * write (two tabs, two uploads). Only a retry of this same line may go on; otherwise the line fails
 * before its own link is set, so its claim is released and it is never stored as matched.
 */
async function assertWon(res: { matchedCount: number }, holder: () => Promise<unknown>, txn: Types.ObjectId) {
  if (res.matchedCount > 0) return;
  const held = await holder();
  if (!held || String(held) !== String(txn)) throw alreadyLinked();
}

/**
 * Adds the line to a transfer, unless another line of this account joined it at the same moment:
 * then this line is taken back out (before the error, so its claim is released) and fails.
 */
async function joinTransfer(transferId: Types.ObjectId, txn: Types.ObjectId, accountId: string): Promise<boolean> {
  await AccountTransfer.updateOne({ _id: transferId }, { $addToSet: { bankTransactions: txn } });
  const t = await AccountTransfer.findById(transferId, { bankTransactions: 1 }).lean();
  const others = (t?.bankTransactions ?? []).filter((x) => String(x) !== String(txn));
  if (!others.length || !(await BankTransaction.exists({ _id: { $in: others }, account: oid(accountId) }))) return true;
  await AccountTransfer.updateOne({ _id: transferId }, { $pull: { bankTransactions: txn } });
  return false;
}

/** The record moves money the other way than the line. */
function assertSide(l: AddLineValues, recordOut: boolean) {
  if (isOut(l) === recordOut) return;
  throw new AppError(
    recordOut ? "That record is money paid out, and this line is a deposit. Pick another match." : "That record is money received, and this line is a withdrawal. Pick another match.",
    "invalid",
  );
}

/** The record's money is in this account, as the review requires before it offers the record (placement). */
async function assertInAccount(ctx: Ctx, method: string | null | undefined, account: unknown) {
  if (placement(await ctx.book(), `cash:${ctx.accountId}`, method, account).ok) return;
  throw new AppError("That record's money is booked to another account, not this one. Pick another match, or set the record's account to this one first.", "invalid");
}

const notOffered = (why: string) => new AppError(`That record cannot be tied to a statement line: ${why}. Pick another match or add the line as new.`, "invalid");

/** An expense whose money is moved by another record, or that is not a company cost of its own. */
function assertMovesMoney(e: { source?: string | null; countedAtPurchase?: boolean | null }) {
  if (e.countedAtPurchase === true || (UNMATCHED_EXPENSE_SOURCES as string[]).includes(e.source ?? "manual")) throw notOffered("it moves no money of its own");
}

/**
 * "Already recorded": ties the line to the record, and the record to the line when it has no line yet.
 * The browser names the record, so the record is checked again here the way the review chose it
 * (review.ts loadCandidates): the same side as the line, its money in this account, a kind of record
 * the review offers, and a salary record only for people who may see salaries.
 */
async function linkExisting(l: AddLineValues, txn: Types.ObjectId, ctx: Ctx): Promise<LinkRef> {
  const [kind, id] = (l.decision.matchKey ?? "").split(":");
  if (!kind || !id || !Types.ObjectId.isValid(id)) throw new AppError("Pick the record this line matches.", "invalid");
  const _id = oid(id);
  // A record tied to another line of this account cannot take a second one (a bill can: it may be paid in parts).
  if (kind !== "bill" && (await BankTransaction.exists({ account: oid(ctx.accountId), "link.kind": kind, "link.id": _id, _id: { $ne: txn } }))) throw alreadyLinked();
  switch (kind) {
    case "expense": {
      const e = await Expense.findById(_id, { amount: 1, bankTransaction: 1, paymentMethod: 1, account: 1, payments: 1, source: 1, countedAtPurchase: 1, category: 1 }).lean();
      if (!e) throw notFound("The expense");
      assertSide(l, true);
      if (e.category === "salaries" && !ctx.salaryRecords) throw salaryRefused();
      assertMovesMoney(e);
      if (Array.isArray(e.payments)) throw notOffered("its payments are recorded on it, so pick the payment, or the bill when it is still owed");
      if (e.paymentMethod === "credit") throw notOffered("it is on credit and not paid yet, so pick the bill to record this line as its payment");
      await assertInAccount(ctx, e.paymentMethod, e.account);
      assertSameAmount(e.amount, l);
      if (e.bankTransaction && String(e.bankTransaction) !== String(txn)) throw alreadyLinked();
      const res = await Expense.updateOne({ _id, bankTransaction: { $exists: false } }, { $set: { bankTransaction: txn } });
      await assertWon(res, async () => (await Expense.findById(_id, { bankTransaction: 1 }).lean())?.bankTransaction, txn);
      return { kind, id };
    }
    case "expensePayment": {
      const e = await Expense.findOne({ "payments._id": _id }, { payments: 1, source: 1, countedAtPurchase: 1, category: 1 }).lean();
      const p = e?.payments?.find((x) => String(x._id) === id);
      if (!e || !p) throw notFound("The payment");
      assertSide(l, true);
      if (e.category === "salaries" && !ctx.salaryRecords) throw salaryRefused();
      assertMovesMoney(e);
      await assertInAccount(ctx, p.paymentMethod, p.account);
      assertSameAmount(p.amount, l);
      if (p.bankTransaction && String(p.bankTransaction) !== String(txn)) throw alreadyLinked();
      const res = await Expense.updateOne({ _id: e._id, payments: { $elemMatch: { _id, bankTransaction: { $exists: false } } } }, { $set: { "payments.$.bankTransaction": txn } });
      await assertWon(res, async () => (await Expense.findById(e._id, { payments: 1 }).lean())?.payments?.find((x) => String(x._id) === id)?.bankTransaction, txn);
      return { kind, id };
    }
    case "bill":
      return payBill(l, _id, txn, ctx);
    case "income": {
      const i = await Income.findById(_id, { amount: 1, bankTransaction: 1, paymentMethod: 1, account: 1 }).lean();
      if (!i) throw notFound("The income record");
      assertSide(l, false);
      await assertInAccount(ctx, i.paymentMethod, i.account);
      assertSameAmount(i.amount, l);
      if (i.bankTransaction && String(i.bankTransaction) !== String(txn)) throw alreadyLinked();
      const res = await Income.updateOne({ _id, bankTransaction: { $exists: false } }, { $set: { bankTransaction: txn } });
      await assertWon(res, async () => (await Income.findById(_id, { bankTransaction: 1 }).lean())?.bankTransaction, txn);
      return { kind, id };
    }
    case "capitalEntry": {
      const c = await CapitalEntry.findById(_id, { amount: 1, bankTransaction: 1, type: 1, paymentMethod: 1, account: 1 }).lean();
      if (!c) throw notFound("The equity entry");
      // Capital comes in; drawings and dividends go out. Reserves and retained earnings move no money.
      if (c.type !== "capital" && c.type !== "drawing" && c.type !== "dividend") throw notOffered("it moves no money in or out of an account");
      assertSide(l, c.type !== "capital");
      await assertInAccount(ctx, c.paymentMethod ?? "bank_transfer", c.account);
      assertSameAmount(c.amount, l);
      if (c.bankTransaction && String(c.bankTransaction) !== String(txn)) throw alreadyLinked();
      const res = await CapitalEntry.updateOne({ _id, bankTransaction: { $exists: false } }, { $set: { bankTransaction: txn } });
      await assertWon(res, async () => (await CapitalEntry.findById(_id, { bankTransaction: 1 }).lean())?.bankTransaction, txn);
      return { kind, id };
    }
    case "liability": {
      const loan = await Liability.findById(_id, { originalAmount: 1, bankTransaction: 1, source: 1 }).lean();
      if (!loan) throw notFound("The loan");
      assertSide(l, false);
      if (loan.source?.mode !== "account") throw notOffered("the loan was not paid into an account");
      await assertInAccount(ctx, loan.source.paymentMethod ?? "bank_transfer", loan.source.account);
      assertSameAmount(loan.originalAmount, l);
      if (loan.bankTransaction && String(loan.bankTransaction) !== String(txn)) throw alreadyLinked();
      const res = await Liability.updateOne({ _id, bankTransaction: { $exists: false } }, { $set: { bankTransaction: txn } });
      await assertWon(res, async () => (await Liability.findById(_id, { bankTransaction: 1 }).lean())?.bankTransaction, txn);
      return { kind, id };
    }
    case "liabilityPayment": {
      const loan = await Liability.findOne({ "payments._id": _id }, { payments: 1 }).lean();
      const p = loan?.payments?.find((x) => String(x._id) === id);
      if (!loan || !p) throw notFound("The repayment");
      assertSide(l, true);
      await assertInAccount(ctx, p.paymentMethod ?? "bank_transfer", p.account);
      assertSameAmount((p.principal ?? 0) + (p.interest ?? 0), l);
      if (p.bankTransaction && String(p.bankTransaction) !== String(txn)) throw alreadyLinked();
      const res = await Liability.updateOne({ _id: loan._id, payments: { $elemMatch: { _id, bankTransaction: { $exists: false } } } }, { $set: { "payments.$.bankTransaction": txn } });
      await assertWon(res, async () => (await Liability.findById(loan._id, { payments: 1 }).lean())?.payments?.find((x) => String(x._id) === id)?.bankTransaction, txn);
      // Only once the repayment is this line's: its interest expense points at the line too, as when the line itself made the repayment.
      if (p.expense) await Expense.updateOne({ _id: p.expense, source: "liability_interest", bankTransaction: { $exists: false } }, { $set: { bankTransaction: txn } });
      return { kind, id };
    }
    case "accountTransfer": {
      const t = await AccountTransfer.findById(_id, { amount: 1, from: 1, to: 1 }).lean();
      if (!t) throw notFound("The transfer");
      assertSameAmount(t.amount, l);
      if (String(isOut(l) ? t.from : t.to) !== ctx.accountId) throw new AppError("That transfer does not move money this way for this account. Pick another match.", "invalid");
      if (!(await joinTransfer(_id, txn, ctx.accountId))) throw alreadyLinked();
      return { kind, id };
    }
    default:
      throw new AppError("Pick the record this line matches.", "invalid");
  }
}

/**
 * Pays an unpaid bill from this line: a payment on the expense, dated and paid like the line. It
 * refuses what Record payment refuses (applyExpensePayment in expenses/payment-core.ts): an expense
 * that takes no payments, a salary bill without the salaries permission, and a date after today.
 */
async function payBill(l: AddLineValues, _id: Types.ObjectId, txn: Types.ObjectId, ctx: Ctx): Promise<LinkRef> {
  const e = await Expense.findById(_id, { amount: 1, date: 1, paymentMethod: 1, account: 1, dueDate: 1, payments: 1, source: 1, category: 1, countedAtPurchase: 1 }).lean();
  if (!e) throw notFound("The bill");
  if (!isOut(l)) throw new AppError("A deposit cannot pay a bill.", "invalid");
  assertTakesPayments(e);
  if (e.category === "salaries" && !ctx.salaryRecords) throw salaryRefused();
  if (fromDateInput(l.date).getTime() > endOfDayIST().getTime()) throw new AppError("A payment can't be dated in the future.", "invalid");
  const state = paymentState(e);
  if (l.withdrawal > state.outstanding + 0.005) throw new AppError(`Only ${state.outstanding.toFixed(2)} is still owed on that bill.`, "invalid");
  const paymentId = new Types.ObjectId();
  const payment = {
    _id: paymentId,
    date: fromDateInput(l.date),
    amount: round2(l.withdrawal),
    paymentMethod: l.decision.paymentMethod,
    account: oid(ctx.accountId),
    reference: l.reference,
    note: "Paid as shown on the bank statement",
    bankTransaction: txn,
    createdBy: Types.ObjectId.isValid(ctx.userId) ? oid(ctx.userId) : undefined,
  };
  // Guarded: the payments may not have changed since they were read, so a bill is never paid twice over.
  const unchanged = Array.isArray(e.payments) ? { payments: { $size: e.payments.length } } : { payments: { $exists: false } };
  const res = await Expense.updateOne({ _id, ...unchanged }, { $push: { payments: payment } });
  if (res.matchedCount === 0) throw new AppError("That bill was paid or changed meanwhile. Upload the statement again to check it.", "conflict");
  return { kind: "expensePayment", id: String(paymentId) };
}

/** The project must exist and not be cancelled. Every project expense belongs to a stage. */
async function assertProject(projectId: string | undefined, needsStage: { stage: string | undefined } | null): Promise<void> {
  if (!projectId) return;
  const p = await Project.findById(projectId, { status: 1 }).lean();
  if (!p) throw notFound("The project");
  if (p.status === "cancelled") throw new AppError("That project is cancelled and takes no new records. Pick another project.", "invalid");
  if (needsStage && !needsStage.stage) throw new AppError("Pick the project stage for this expense.", "invalid");
}

/** A transfer the other account's statement already recorded: same accounts, same amount, within three days, without this side yet. */
async function otherSideTransfer(l: AddLineValues, fromId: string, toId: string): Promise<Types.ObjectId | null> {
  const day = fromDateInput(l.date);
  const candidates = await AccountTransfer.find(
    { from: oid(fromId), to: oid(toId), amount: amountOf(l), date: { $gte: addDays(day, -MATCH_DAYS), $lte: addDays(day, MATCH_DAYS) } },
    { bankTransactions: 1, date: 1 },
  ).lean();
  const ownLines = new Set(
    (await BankTransaction.find({ _id: { $in: candidates.flatMap((c) => c.bankTransactions ?? []) }, account: oid(isOut(l) ? fromId : toId) }, { _id: 1 }).lean()).map((t) => String(t._id)),
  );
  const free = candidates
    .filter((c) => !(c.bankTransactions ?? []).some((id) => ownLines.has(String(id))))
    .sort((a, b) => Math.abs(a.date.getTime() - day.getTime()) - Math.abs(b.date.getTime() - day.getTime()));
  return free[0]?._id ?? null;
}

/** Creates the one record a line becomes. */
async function createRecord(l: AddLineValues, txn: Types.ObjectId, ctx: Ctx): Promise<LinkRef | null> {
  const d = l.decision;
  const date = fromDateInput(l.date);
  const amount = amountOf(l);
  const user = Types.ObjectId.isValid(ctx.userId) ? oid(ctx.userId) : undefined;
  const out = isOut(l);
  // The add schema already refuses such a line; this keeps a zero-amount record out of the books whoever calls this.
  if (d.action !== "ignore" && (!(amount > 0) || (l.withdrawal > 0 && l.deposit > 0))) {
    throw new AppError("This line needs one amount: a withdrawal or a deposit above zero, not both.", "invalid");
  }
  switch (d.action) {
    case "ignore":
      return null;
    case "match":
      return linkExisting(l, txn, ctx);
    case "expense": {
      if (!out) throw new AppError("A deposit cannot be an expense. Choose New income or another action.", "invalid");
      if (!d.party) throw new AppError("Enter the vendor.", "invalid");
      if (!d.category) throw new AppError("Pick a category.", "invalid");
      await assertExpenseCategoryAllowed(d.category);
      await assertProject(d.projectId, { stage: d.stage });
      const created = await Expense.create({
        number: await nextNumber("expense", undefined, date),
        vendor: d.party,
        project: d.projectId ? oid(d.projectId) : undefined,
        stage: d.projectId ? d.stage : undefined,
        category: d.category,
        description: d.description,
        amount,
        date,
        paymentMethod: d.paymentMethod,
        notes: statementNote(l),
        source: "manual",
        account: oid(ctx.accountId),
        bankTransaction: txn,
        createdBy: user,
      });
      return { kind: "expense", id: String(created._id) };
    }
    case "income": {
      if (out) throw new AppError("A withdrawal cannot be income. Choose New expense or another action.", "invalid");
      if (!d.party) throw new AppError("Enter who paid.", "invalid");
      await assertProject(d.projectId, null);
      // Pays an open customer invoice: linked to it when the receipt rules allow.
      const link = await invoiceForReceipt({ invoiceId: d.invoiceId, client: d.party, projectId: d.projectId, amount, date: l.date });
      const created = await Income.create({
        ...(link.invoice ? { invoice: link.invoice } : {}),
        number: await nextNumber("income", undefined, date),
        client: d.party,
        project: d.projectId ? oid(d.projectId) : undefined,
        category: d.incomeCategory ?? "project_payment",
        amount,
        date,
        paymentMethod: d.paymentMethod,
        reference: l.reference,
        notes: [d.description, statementNote(l)].filter(Boolean).join("\n").slice(0, 4000),
        account: oid(ctx.accountId),
        bankTransaction: txn,
        createdBy: user,
      });
      // Best effort: the income is saved, and the link already passed the receipt rules.
      const note = await confirmReceiptLink(created._id, link).catch((e: unknown) => {
        console.error("[bank-statements] could not check an invoice link", e);
        return link.note;
      });
      if (note) ctx.notes.set(String(txn), note);
      return { kind: "income", id: String(created._id) };
    }
    case "capital":
    case "drawing": {
      if (d.action === "capital" && out) throw new AppError("Capital comes in: a withdrawal cannot be capital introduced. Choose Owner drawing.", "invalid");
      if (d.action === "drawing" && !out) throw new AppError("A drawing takes money out: a deposit cannot be one. Choose Capital introduced.", "invalid");
      const created = await createCapitalEntry(
        {
          type: d.action,
          holderId: d.holderId,
          date,
          amount,
          paymentMethod: d.paymentMethod,
          accountId: ctx.accountId,
          reference: l.reference,
          purpose: d.description,
          notes: statementNote(l),
          bankTransactionId: String(txn),
        },
        ctx.userId,
      );
      return { kind: "capitalEntry", id: created.id };
    }
    case "loan_received": {
      if (out) throw new AppError("A loan received comes in: a withdrawal cannot be one. Choose Loan repayment.", "invalid");
      if (!d.loanGroup) throw new AppError("Pick the group the loan belongs to.", "invalid");
      const lender = d.party ?? "";
      const created = await createLiability(
        {
          name: d.loanName ?? `Loan from ${lender}`.slice(0, 160),
          group: d.loanGroup,
          lender,
          originalAmount: amount,
          date,
          source: { mode: "account", accountId: ctx.accountId, paymentMethod: d.paymentMethod },
          reference: l.reference,
          notes: statementNote(l),
          bankTransactionId: String(txn),
          kind: "loan",
        },
        ctx.userId,
      );
      return { kind: "liability", id: created.id };
    }
    case "loan_payment": {
      if (!out) throw new AppError("A repayment takes money out: a deposit cannot be one. Choose Loan received.", "invalid");
      if (!d.loanId) throw new AppError("Pick the loan this repays.", "invalid");
      const principal = round2(d.principal ?? amount);
      const interest = round2(d.interest ?? 0);
      if (Math.abs(principal + interest - amount) >= 0.005) {
        throw new AppError(`Principal and interest add up to ${(principal + interest).toFixed(2)}, not the ${amount.toFixed(2)} on the statement.`, "invalid");
      }
      const created = await addLiabilityPayment(
        { liabilityId: d.loanId, date, principal, interest, paymentMethod: d.paymentMethod, accountId: ctx.accountId, reference: l.reference, note: statementNote(l).slice(0, 1000), bankTransactionId: String(txn) },
        ctx.userId,
      );
      return { kind: "liabilityPayment", id: created.paymentId };
    }
    case "transfer": {
      if (!d.otherAccountId) throw new AppError("Pick the other account.", "invalid");
      if (d.otherAccountId === ctx.accountId) throw new AppError("Pick another account than this statement's.", "invalid");
      const [fromId, toId] = out ? [ctx.accountId, d.otherAccountId] : [d.otherAccountId, ctx.accountId];
      // The other account's statement may have recorded this transfer already: this line is its other side.
      const existing = await otherSideTransfer(l, fromId, toId);
      if (existing) {
        if (!(await joinTransfer(existing, txn, ctx.accountId))) {
          throw new AppError("Another line of this account joined that transfer at the same moment. Upload the statement again to check this line.", "conflict");
        }
        return { kind: "accountTransfer", id: String(existing) };
      }
      const created = await createAccountTransfer({ fromAccountId: fromId, toAccountId: toId, amount, date, reference: l.reference, notes: statementNote(l).slice(0, 1000), bankTransactionIds: [String(txn)] }, ctx.userId);
      return { kind: "accountTransfer", id: created.id };
    }
  }
}

/**
 * Undoes a claim after its line failed. A claim made by this add is removed, so the line can be
 * added once its problem is fixed. A line reopened from an earlier upload is never removed: it gets
 * back what it held, so the earlier statement keeps its line.
 */
async function releaseClaim(claim: Claim) {
  if (await recordHolding(claim.id)) return;
  if (claim.fresh) {
    await BankTransaction.deleteOne({ _id: claim.id, link: { $exists: false } });
    return;
  }
  const { action, statement, link, updatedAt, unmatchedAt, unmatchedBy } = claim.prior;
  await BankTransaction.updateOne(
    { _id: claim.id, link: { $exists: false } },
    {
      $set: {
        action,
        ...(statement ? { statement } : {}),
        ...(link ? { link } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...(unmatchedAt ? { unmatchedAt } : {}),
        ...(unmatchedBy ? { unmatchedBy } : {}),
      },
    },
    // The time and the unmatch marker go back to what they were, so a cut-off or unmatched line can still be added again at once.
    { timestamps: false },
  );
}

/**
 * A line whose record was deleted and which was added again is counted again by the statement it
 * is added to (the same one when it is added again from the statement's own page): the statement
 * that counted it before stops counting it, so lists and counts agree. An unmatched line was
 * uncounted when it was unmatched (it has no link here).
 */
async function moveCount(prior: Prior) {
  if (!prior.link || !prior.statement) return;
  const field = prior.action === "ignore" ? "ignored" : prior.action === "match" ? "matched" : "added";
  await BankStatement.updateOne({ _id: prior.statement, [field]: { $gt: 0 } }, { $inc: { [field]: -1 } });
}

async function addOne(l: AddLineValues, ctx: Ctx): Promise<{ result: Omit<AddLineResult, "label" | "href">; link: LinkRef | null }> {
  const hash = lineHash(ctx.accountId, l, l.occurrence);
  const base = { hash, line: l.line };
  let claim: Awaited<ReturnType<typeof claimLine>>;
  try {
    claim = await claimLine(l, hash, ctx);
  } catch (error) {
    if (!(error instanceof AppError)) console.error("[bank-statements] claim failed", error);
    return { result: { ...base, status: "failed", message: error instanceof AppError ? error.message : "This line could not be saved. Try again." }, link: null };
  }
  if ("taken" in claim) return { result: { ...base, status: "already", message: claim.taken }, link: claim.link };
  try {
    const held = claim.fresh ? null : await recordHolding(claim.id);
    const link = held ?? (await createRecord(l, claim.id, ctx));
    // A reopened line takes this add's type and row with its new link; a fresh claim has them already.
    const reopenedFields = claim.fresh ? {} : { kind: kindOf(l), ...placeOf(l) };
    if (link) await BankTransaction.updateOne({ _id: claim.id }, { $set: { link: { kind: link.kind, id: oid(link.id) }, ...reopenedFields } });
    else if (!claim.fresh) await BankTransaction.updateOne({ _id: claim.id }, { $set: reopenedFields });
    // Remembered for the next statement. Best effort, after the record is saved: it never fails the line.
    if (!held && link) await learnFromLine(l, link, ctx.userId, ctx.salaries);
    // Bookkeeping of the counts only: the line is added either way.
    if (!claim.fresh) await moveCount(claim.prior).catch((e: unknown) => console.error("[bank-statements] could not move a count", e));
    const status = l.decision.action === "ignore" ? "ignored" : l.decision.action === "match" ? "matched" : "added";
    const message = status === "ignored" ? "Ignored" : status === "matched" ? "Tied to the record already in the books" : "Added";
    return { result: { ...base, status, message, note: ctx.notes.get(String(claim.id)) ?? null }, link };
  } catch (error) {
    await releaseClaim(claim).catch((e: unknown) => console.error("[bank-statements] could not release a claim", e));
    if (error instanceof AppError) return { result: { ...base, status: "failed", message: error.message }, link: null };
    if (isDuplicateKeyError(error)) return { result: { ...base, status: "failed", message: "A record with the same number already exists. Try again." }, link: null };
    console.error("[bank-statements] line failed", error);
    return { result: { ...base, status: "failed", message: "Something went wrong with this line. Try again." }, link: null };
  }
}

/**
 * Adds a batch of reviewed lines for one account. Safe to repeat: lines already added are reported, not added again.
 * `options.salaries`: the person may see salaries, so a salary payee's remembered party may change.
 * `options.salaryRecords`: the person may pay salary bills and tie lines to salary expenses. The add
 * action always sets it from data.salaries; an internal caller that leaves it out is not limited.
 */
export async function addStatementLines(
  input: AddLinesValues,
  userId: string,
  options: { salaries?: boolean; salaryRecords?: boolean } = {},
): Promise<AddBatchResult> {
  await requireIndexes(BankTransaction);
  const account = await BankAccount.findById(input.accountId, { kind: 1, archivedAt: 1, name: 1 }).lean();
  if (!account) throw notFound("The bank account");
  if (account.archivedAt) throw new AppError(`${account.name} is archived. Restore it on Cash & bank before adding its statement.`, "invalid");

  let statementId: Types.ObjectId | null = input.statementId ? oid(input.statementId) : null;
  if (statementId && !(await BankStatement.exists({ _id: statementId, account: account._id }))) throw notFound("The statement");
  let book: Promise<AccountBook> | null = null;
  // The statement record is made with the first line that is really new, so an upload that adds nothing leaves no trace.
  const ctx: Ctx = {
    accountId: input.accountId,
    userId,
    salaries: options.salaries ?? false,
    salaryRecords: options.salaryRecords ?? true,
    notes: new Map(),
    book: () => (book ??= loadAccountBook()),
    statementId: async () => {
      if (!statementId) {
        const s = input.statement;
        const created = await BankStatement.create({
          account: account._id,
          fileName: s.fileName || undefined,
          from: s.from ? fromDateInput(s.from) : undefined,
          to: s.to ? fromDateInput(s.to) : undefined,
          openingBalance: s.opening ?? undefined,
          closingBalance: s.closing ?? undefined,
          lines: s.lines,
          createdBy: Types.ObjectId.isValid(userId) ? oid(userId) : undefined,
        });
        statementId = created._id;
      }
      return statementId;
    },
  };

  const results: (Omit<AddLineResult, "label" | "href"> & { link: LinkRef | null })[] = [];
  for (const l of input.lines) {
    const { result, link } = await addOne(l, ctx);
    results.push({ ...result, link });
  }
  // The audit trail: what each line made, paid or matched, with this statement. Best effort.
  await auditStatementLines(input.accountId, input.lines, results, statementId);
  if (statementId) {
    const count = (s: AddLineResult["status"]) => results.filter((r) => r.status === s).length;
    await BankStatement.updateOne({ _id: statementId }, { $inc: { added: count("added"), matched: count("matched"), ignored: count("ignored") } });
  }
  const info = await describeLinks(results.flatMap((r) => (r.link ? [r.link] : [])));
  return {
    statementId: statementId ? String(statementId) : null,
    results: results.map(({ link, ...r }) => {
      const i = link ? info.get(`${link.kind}:${link.id}`) : undefined;
      return { ...r, label: i?.label ?? null, href: i?.href ?? null, recordKind: link?.kind ?? null, recordId: link?.id ?? null };
    }),
  };
}
