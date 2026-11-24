import "server-only";

import { Types } from "mongoose";
import { connectDB, runAtomic } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import { BankAccount, Expense, FileModel, Liability } from "@/server/models";
import { loadFinanceGroups } from "@/server/finance-groups";
import { assertExpenseCategoryAllowed } from "@/server/expense-categories";
import { nextNumber } from "@/server/services/numbering";
import { liabilityState } from "@/server/finance/summaries";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { endOfDayIST, startOfDayIST } from "@/lib/dates";
import { formatCurrency, round2 } from "@/lib/format";
import { MAX_MONEY } from "@/lib/zod";
import { unmatchHint } from "@/features/finance/bank-statements/line-href";
import type { LiabilityKind, LiabilitySource, PaymentMethod } from "@/lib/constants";
import { canHoldRecords } from "./groups";

/**
 * Writing liabilities: taking one on, repaying it, and undoing a repayment. Plain server functions
 * (not actions), so the Liabilities actions and the bank statement import share one set of rules.
 *
 * A repayment's principal only reduces the loan. Its interest is a cost of the period, so it is
 * booked as its own expense record (category "interest", source "liability_interest") paid on the
 * same day from the same account, and the repayment keeps that expense's id. That way the interest
 * shows in Expenses and in the P&L as a finance cost, and principal never does.
 */

const NO_MONEY_METHODS = new Set<PaymentMethod>(["credit", "stock"]);

const oid = (id: string) => new Types.ObjectId(id);
const rupees = (n: number) => formatCurrency(n, { exact: true });

/**
 * A record matched to a bank statement line keeps what the line shows; the statement holds the
 * money movement. The message ends with the line's page, where it can be unmatched (by people who
 * can edit bank statements).
 */
const bankMatched = (line: Types.ObjectId) =>
  `It is matched to a bank statement line, so its amount, account and existence follow that line.${unmatchHint([String(line)])}`;

function assertAmount(value: number, field: string, label: string, { positive }: { positive: boolean }) {
  if (!Number.isFinite(value) || value < 0 || (positive && value <= 0) || value > MAX_MONEY) {
    throw new AppError(`${label} is not a valid amount.`, "invalid", { [field]: [positive ? "Must be more than zero" : "Cannot be negative"] });
  }
}

/** The group must take records of this kind (see groups.ts). */
async function assertRecordGroup(group: string, kind: LiabilityKind) {
  const groups = await loadFinanceGroups("liability");
  if (!canHoldRecords(groups, group, kind)) {
    throw new AppError(kind === "loan" ? "Pick one of the loan groups listed." : "Pick one of the groups listed.", "invalid", { group: ["Pick one of the groups listed"] });
  }
}

/**
 * The account money moves through and the method recorded with it. An account that is picked must
 * exist and be open; with no account the method decides (the default account for that method).
 */
async function resolveMoney(accountId: string | undefined, method: PaymentMethod | undefined) {
  if (method && NO_MONEY_METHODS.has(method)) {
    throw new AppError("Pick how the money moved.", "invalid", { paymentMethod: ["On credit and From stock do not apply here"] });
  }
  if (!accountId) return { account: undefined, paymentMethod: method ?? ("bank_transfer" as PaymentMethod) };
  if (!Types.ObjectId.isValid(accountId)) throw new AppError("Pick one of the accounts listed.", "invalid", { accountId: ["Pick one of the accounts listed"] });
  const account = await BankAccount.findOne({ _id: oid(accountId), archivedAt: null }, { kind: 1 }).lean();
  if (!account) throw new AppError("That account was not found or is closed.", "invalid", { accountId: ["Pick one of the accounts listed"] });
  return { account: account._id, paymentMethod: method ?? ((account.kind === "cash" ? "cash" : "bank_transfer") as PaymentMethod) };
}

/* Taking a liability on */

export type CreateLiabilityInput = {
  name: string;
  group: string;
  lender: string;
  originalAmount: number;
  date: Date;
  dueDate?: Date;
  interestRate?: number;
  /**
   * "account": the money was received into a bank or cash account; "opening": owed before the books
   * started; "accrued": a cost of the period not paid yet (other obligations only), booked as an
   * expense of `category` on its date.
   */
  source: { mode: LiabilitySource; accountId?: string; paymentMethod?: PaymentMethod; category?: string };
  reference?: string;
  notes?: string;
  bankTransactionId?: string;
  kind?: LiabilityKind;
  tenureMonths?: number;
  installment?: number;
};

function checkTerms(input: { name: string; lender: string; originalAmount: number; date: Date; dueDate?: Date; interestRate?: number; tenureMonths?: number; installment?: number }) {
  if (!input.name?.trim()) throw new AppError("Name is required.", "invalid", { name: ["Name is required"] });
  if (!input.lender?.trim()) throw new AppError("Lender is required.", "invalid", { lender: ["Lender is required"] });
  assertAmount(input.originalAmount, "originalAmount", "The amount", { positive: true });
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) throw new AppError("Pick the date it was taken.", "invalid", { date: ["Pick a date"] });
  // A liability counts from the day it was taken on, so a future date would be missing from today's balance sheet.
  if (input.date.getTime() > endOfDayIST().getTime()) throw new AppError("The date cannot be in the future.", "invalid", { date: ["Cannot be in the future"] });
  if (input.dueDate && input.dueDate.getTime() < startOfDayIST(input.date).getTime()) {
    throw new AppError("The due date cannot be before the date it was taken.", "invalid", { dueDate: ["Cannot be before the date it was taken"] });
  }
  if (input.interestRate !== undefined && !(input.interestRate >= 0 && input.interestRate <= 100)) {
    throw new AppError("The interest rate must be between 0 and 100%.", "invalid", { interestRate: ["Between 0 and 100"] });
  }
  if (input.tenureMonths !== undefined && !(Number.isInteger(input.tenureMonths) && input.tenureMonths >= 1 && input.tenureMonths <= 600)) {
    throw new AppError("The tenure must be 1 to 600 whole months.", "invalid", { tenureMonths: ["1 to 600 months"] });
  }
  if (input.installment !== undefined) assertAmount(input.installment, "installment", "The instalment", { positive: true });
}

/**
 * An accrued liability is an expense not paid yet, so only other obligations take it (a loan's
 * principal is never an expense) and it needs the expense category the cost belongs to. A record
 * that keeps its current category always saves, even if that category was hidden since.
 */
async function accruedCategory(source: CreateLiabilityInput["source"], kind: LiabilityKind, current?: string | null): Promise<string | undefined> {
  if (source.mode !== "accrued") return undefined;
  if (kind === "loan") {
    throw new AppError("A loan is not an expense. Pick where the money went or that it was owed before the books started.", "invalid", {
      sourceMode: ["Not for loans"],
    });
  }
  const category = source.category?.trim();
  if (!category) throw new AppError("Pick the expense category the cost belongs to.", "invalid", { category: ["Pick a category"] });
  await assertExpenseCategoryAllowed(category, current);
  return category;
}

/** Records a new loan or other obligation. Returns its id and its code (LIA-0007). */
export async function createLiability(input: CreateLiabilityInput, userId: string): Promise<{ id: string; code: string }> {
  await connectDB();
  const kind = input.kind ?? "loan";
  checkTerms(input);
  await assertRecordGroup(input.group, kind);
  const category = await accruedCategory(input.source, kind);
  const money =
    input.source.mode === "account" ? await resolveMoney(input.source.accountId, input.source.paymentMethod) : { account: undefined, paymentMethod: undefined };
  const code = await nextNumber("liability");
  const created = await Liability.create({
    code,
    name: input.name.trim(),
    kind,
    group: input.group,
    lender: input.lender.trim(),
    originalAmount: round2(input.originalAmount),
    date: input.date,
    dueDate: input.dueDate,
    interestRate: input.interestRate,
    tenureMonths: kind === "loan" ? input.tenureMonths : undefined,
    installment: kind === "loan" && input.installment !== undefined ? round2(input.installment) : undefined,
    source: { mode: input.source.mode, account: money.account, paymentMethod: money.paymentMethod, category },
    payments: [],
    reference: input.reference?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    bankTransaction: input.bankTransactionId && Types.ObjectId.isValid(input.bankTransactionId) ? oid(input.bankTransactionId) : undefined,
    createdBy: Types.ObjectId.isValid(userId) ? oid(userId) : undefined,
  });
  return { id: String(created._id), code };
}

/* Editing */

export type UpdateLiabilityInput = Omit<CreateLiabilityInput, "bankTransactionId" | "kind"> & { id: string; kind: LiabilityKind };

/**
 * Changes what the form shows and keeps everything else (repayments, the bank statement link, who
 * created it). The amount cannot drop below the principal already repaid, and the date cannot move
 * after the first repayment.
 */
export async function updateLiability(input: UpdateLiabilityInput): Promise<{ id: string }> {
  await connectDB();
  const existing = await Liability.findById(input.id).lean();
  if (!existing) throw notFound("The liability");
  checkTerms(input);
  await assertRecordGroup(input.group, input.kind);
  const category = await accruedCategory(input.source, input.kind, existing.source?.category);
  const state = liabilityState(existing);
  const amount = round2(input.originalAmount);
  if (amount + 0.005 < state.principalPaid) {
    throw new AppError(`The amount cannot be less than the ${rupees(state.principalPaid)} of principal already repaid.`, "invalid", {
      originalAmount: ["Less than the principal already repaid"],
    });
  }
  const first = (existing.payments ?? []).reduce<Date | null>((d, p) => (!d || p.date.getTime() < d.getTime() ? p.date : d), null);
  if (first && input.date.getTime() > endOfDayIST(first).getTime()) {
    throw new AppError("The date cannot be after the first repayment.", "invalid", { date: ["After the first repayment"] });
  }
  // The account it was received into stays usable after that account is closed: only a new account is checked.
  const keptAccount =
    input.source.mode === "account" && existing.source?.mode === "account" && existing.source.account && input.source.accountId === String(existing.source.account);
  const money = keptAccount
    ? {
        account: existing.source.account,
        paymentMethod:
          input.source.paymentMethod && !NO_MONEY_METHODS.has(input.source.paymentMethod)
            ? input.source.paymentMethod
            : ((existing.source.paymentMethod ?? "bank_transfer") as PaymentMethod),
      }
    : input.source.mode === "account"
      ? await resolveMoney(input.source.accountId, input.source.paymentMethod)
      : { account: undefined, paymentMethod: undefined };
  if (existing.bankTransaction) {
    const sameAccount = input.source.mode === existing.source?.mode && String(money.account ?? "") === String(existing.source?.account ?? "");
    if (Math.abs(amount - existing.originalAmount) >= 0.005) {
      throw new AppError(`The amount cannot change. ${bankMatched(existing.bankTransaction)}`, "conflict", { originalAmount: ["Matched to a bank statement line"] });
    }
    if (!sameAccount) throw new AppError(`Where the money went cannot change. ${bankMatched(existing.bankTransaction)}`, "conflict", { sourceMode: ["Matched to a bank statement line"] });
  }

  const set: Record<string, unknown> = {
    name: input.name.trim(),
    kind: input.kind,
    group: input.group,
    lender: input.lender.trim(),
    originalAmount: amount,
    date: input.date,
    "source.mode": input.source.mode,
  };
  const unset: Record<string, 1> = {};
  const optional = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") unset[key] = 1;
    else set[key] = value;
  };
  optional("dueDate", input.dueDate);
  optional("interestRate", input.interestRate);
  optional("reference", input.reference?.trim());
  optional("notes", input.notes?.trim());
  optional("source.account", money.account);
  optional("source.paymentMethod", money.paymentMethod);
  optional("source.category", category);
  // Tenure and instalment are only on the loan form: an "other" obligation keeps whatever it had.
  if (input.kind === "loan") {
    optional("tenureMonths", input.tenureMonths);
    optional("installment", input.installment !== undefined ? round2(input.installment) : undefined);
  }
  // Guarded like a repayment: a repayment saved meanwhile can never leave more principal repaid than the new amount.
  const result = await Liability.updateOne(
    { _id: existing._id, $expr: { $lte: [{ $sum: { $ifNull: ["$payments.principal", []] } }, amount + 0.005] } },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
  );
  if (result.matchedCount === 0) {
    throw new AppError("A repayment was saved meanwhile and the new amount is less than the principal repaid. Reload and try again.", "conflict");
  }
  return { id: input.id };
}

/** Deletes a liability that has no repayments, with its documents. Anything repaid stays on record. */
export async function deleteLiability(id: string): Promise<{ code: string }> {
  await connectDB();
  const existing = await Liability.findById(id).lean();
  if (!existing) throw notFound("The liability");
  if ((existing.payments ?? []).length > 0) {
    throw new AppError("It has repayments. Delete those first; a liability with repayments stays on record.", "conflict");
  }
  if (existing.bankTransaction) throw new AppError(`It cannot be deleted here. ${bankMatched(existing.bankTransaction)}`, "conflict");
  if (await Expense.exists({ liability: existing._id })) {
    throw new AppError("Interest expenses are still linked to it, so it stays on record.", "conflict");
  }
  const removed = await Liability.deleteOne({ _id: existing._id, payments: { $size: 0 } });
  // A repayment saved since it was read keeps the liability, and its documents with it.
  if (removed.deletedCount === 0) throw new AppError("A repayment was saved meanwhile, so it stays on record. Reload to see it.", "conflict");
  const files = await FileModel.find({ "entity.type": "liability", "entity.id": existing._id }, { _id: 1 }).lean();
  for (const f of files) await removeFile(String(f._id));
  return { code: existing.code };
}

/* Repayments */

export type AddLiabilityPaymentInput = {
  liabilityId: string;
  date: Date;
  principal: number;
  interest: number;
  paymentMethod: PaymentMethod;
  accountId?: string;
  reference?: string;
  note?: string;
  bankTransactionId?: string;
};

/**
 * Records a repayment. The principal cannot be more than what is still owed. Interest above zero
 * becomes an expense paid on that date with that method and account, linked to the loan, and the
 * repayment stores the expense's id so deleting the repayment deletes it too.
 */
export async function addLiabilityPayment(input: AddLiabilityPaymentInput, userId: string): Promise<{ paymentId: string; expenseId: string | null }> {
  await connectDB();
  if (!Types.ObjectId.isValid(input.liabilityId)) throw notFound("The liability");
  const liability = await Liability.findById(input.liabilityId).lean();
  if (!liability) throw notFound("The liability");

  assertAmount(input.principal, "principal", "The principal", { positive: false });
  assertAmount(input.interest, "interest", "The interest", { positive: false });
  const principal = round2(input.principal);
  const interest = round2(input.interest);
  if (principal + interest <= 0) throw new AppError("Enter the principal, the interest or both.", "invalid", { principal: ["Enter an amount"] });
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) throw new AppError("Pick the date it was paid.", "invalid", { date: ["Pick a date"] });
  if (input.date.getTime() < startOfDayIST(liability.date).getTime()) {
    throw new AppError("A repayment cannot be dated before the liability was taken.", "invalid", { date: ["Before the date it was taken"] });
  }
  if (input.date.getTime() > endOfDayIST().getTime()) throw new AppError("A repayment cannot be dated in the future.", "invalid", { date: ["Cannot be in the future"] });

  const state = liabilityState(liability);
  if (principal > state.outstanding + 0.005) {
    throw new AppError(`The principal is more than the ${rupees(state.outstanding)} still owed.`, "invalid", { principal: ["More than what is still owed"] });
  }
  const money = await resolveMoney(input.accountId, input.paymentMethod);
  const user = Types.ObjectId.isValid(userId) ? oid(userId) : undefined;
  const bankTransaction = input.bankTransactionId && Types.ObjectId.isValid(input.bankTransactionId) ? oid(input.bankTransactionId) : undefined;

  return runAtomic(async (uow) => {
    const paymentId = new Types.ObjectId();
    let expenseId: Types.ObjectId | null = null;
    if (interest > 0) {
      const notes = [input.reference ? `Reference: ${input.reference}` : null, input.note ?? null].filter(Boolean).join("\n") || undefined;
      const [expense] = await Expense.create(
        [
          {
            number: await nextNumber("expense", uow.session, input.date),
            vendor: liability.lender,
            category: "interest",
            description: `Interest on ${liability.code} ${liability.name}`,
            amount: interest,
            date: input.date,
            paymentMethod: money.paymentMethod,
            account: money.account,
            source: "liability_interest",
            liability: liability._id,
            notes,
            bankTransaction,
            createdBy: user,
          },
        ],
        { session: uow.session },
      );
      expenseId = expense._id;
      uow.onRollback(() => Expense.deleteOne({ _id: expense._id }));
    }
    // Guarded: two repayments saved at once can never take the principal repaid past the amount owed.
    const result = await Liability.updateOne(
      {
        _id: liability._id,
        $expr: { $lte: [{ $add: [{ $sum: { $ifNull: ["$payments.principal", []] } }, principal] }, { $add: ["$originalAmount", 0.005] }] },
      },
      {
        $push: {
          payments: {
            _id: paymentId,
            date: input.date,
            principal,
            interest,
            paymentMethod: money.paymentMethod,
            account: money.account,
            reference: input.reference?.trim() || undefined,
            note: input.note?.trim() || undefined,
            expense: expenseId ?? undefined,
            bankTransaction,
            createdBy: user,
          },
        },
      },
      { session: uow.session },
    );
    if (result.matchedCount === 0) throw new AppError("Another repayment was saved meanwhile and this one would repay more than is owed. Reload and try again.", "conflict");
    return { paymentId: String(paymentId), expenseId: expenseId ? String(expenseId) : null };
  });
}

/** Removes a repayment and the interest expense it created. The loan's balance goes back up by its principal. */
export async function deleteLiabilityPayment(liabilityId: string, paymentId: string): Promise<{ expenseNumber: string | null }> {
  await connectDB();
  const liability = await Liability.findById(liabilityId).lean();
  if (!liability) throw notFound("The liability");
  const payment = (liability.payments ?? []).find((p) => String(p._id) === paymentId);
  if (!payment) throw notFound("The repayment");
  // Same rule as expense payments: the statement line would still say this money moved.
  if (payment.bankTransaction) throw new AppError(`This repayment cannot be deleted here. ${bankMatched(payment.bankTransaction)}`, "conflict");

  return runAtomic(async (uow) => {
    let expenseNumber: string | null = null;
    if (payment.expense) {
      const expense = await Expense.findOne({ _id: payment.expense, liability: liability._id, source: "liability_interest" }, null, { session: uow.session }).lean();
      if (expense) {
        await Expense.deleteOne({ _id: expense._id }, { session: uow.session });
        uow.onRollback(() => Expense.create(expense));
        expenseNumber = expense.number;
      }
    }
    const result = await Liability.updateOne({ _id: liability._id }, { $pull: { payments: { _id: payment._id } } }, { session: uow.session });
    if (result.modifiedCount === 0) throw notFound("The repayment");
    return { expenseNumber };
  });
}

/* Documents */

/** Files this user just uploaded (or already on this liability) are filed under it. Others are ignored. */
export async function attachLiabilityDocuments(liabilityId: string, fileIds: string[], userId: string): Promise<number> {
  const usable: string[] = [];
  for (const id of fileIds) if (await isClaimableFile(id, liabilityId, { uploadedBy: userId })) usable.push(id);
  await attachFiles(usable, { type: "liability", id: liabilityId });
  return usable.length;
}

export async function removeLiabilityDocument(liabilityId: string, fileId: string): Promise<void> {
  const owned = await FileModel.exists({ _id: oid(fileId), "entity.type": "liability", "entity.id": oid(liabilityId) });
  if (!owned) throw notFound("The document");
  await removeFile(fileId);
}
