import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import { BankAccount, CapitalEntry, EquityHolder } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { endOfDayIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { MAX_MONEY } from "@/lib/zod";
import type { CapitalEntryType, InvestorInstrument, PaymentMethod } from "@/lib/constants";
import { EQUITY_PAYMENT_VALUES, isMoneyEntry } from "./labels";

/**
 * The one way capital entries are written: the equity forms and bank statement imports both go
 * through createCapitalEntry, so the same rules hold everywhere. Capital is equity, never income;
 * the statements read these records on their own (src/server/accounting/ledger.ts).
 */

export type CapitalEntryInput = {
  type: CapitalEntryType;
  holderId?: string;
  date: Date;
  amount: number;
  paymentMethod?: PaymentMethod;
  accountId?: string;
  reference?: string;
  purpose?: string;
  notes?: string;
  initial?: boolean;
  instrument?: InvestorInstrument;
  reserveGroup?: string;
  bankTransactionId?: string;
};

/** The fields of a capital entry the forms control. Undefined means "not set" (unset on update). */
export type EntryFields = {
  holder?: Types.ObjectId;
  date: Date;
  amount: number;
  initial?: boolean;
  instrument?: InvestorInstrument;
  reserveGroup?: string;
  paymentMethod?: PaymentMethod;
  account?: Types.ObjectId;
  reference?: string;
  purpose?: string;
  notes?: string;
};

const invalid = (field: string, message: string, summary = message) => new AppError(summary, "invalid", { [field]: [message] });
const clean = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

/** Reserve groups an entry may go to: anything under Reserves and surplus, not the heading itself. */
export async function reserveGroupKeys(): Promise<string[]> {
  const groups = await loadFinanceGroups("equity");
  return descendantsOf(groups, "reserves_surplus").filter((k) => k !== "reserves_surplus");
}

/**
 * Checks an entry against the rules of its type and returns the fields to store. `existing` is the
 * entry being edited: its own holder and account stay usable even after they are archived.
 */
export async function prepareEntry(
  input: Omit<CapitalEntryInput, "bankTransactionId">,
  existing?: { id: string; holder?: Types.ObjectId | null; account?: Types.ObjectId | null },
): Promise<EntryFields> {
  const { type } = input;
  if (!(input.date instanceof Date) || Number.isNaN(input.date.getTime())) throw invalid("date", "Pick a date");
  if (input.date.getTime() > endOfDayIST(new Date()).getTime()) {
    throw invalid("date", "Cannot be in the future", "The date cannot be in the future. Equity is counted up to today.");
  }
  if (!Number.isFinite(input.amount) || Math.abs(input.amount) > MAX_MONEY) throw invalid("amount", "Enter a valid amount");
  const amount = round2(input.amount);
  if (type === "opening_retained") {
    if (amount === 0) throw invalid("amount", "Enter the amount (negative for accumulated losses)");
  } else if (amount <= 0) {
    throw invalid("amount", "Must be more than zero");
  }

  const fields: EntryFields = { date: input.date, amount, reference: clean(input.reference), purpose: clean(input.purpose), notes: clean(input.notes) };

  // Who: capital and drawings always belong to someone; a dividend may name who received it.
  const takesHolder = type === "capital" || type === "drawing" || type === "dividend";
  if (takesHolder && input.holderId) {
    if (!Types.ObjectId.isValid(input.holderId)) throw invalid("holderId", "Pick one of the people listed");
    const holder = await EquityHolder.findById(input.holderId, { kind: 1, archivedAt: 1, instrument: 1, name: 1 }).lean();
    if (!holder) throw invalid("holderId", "Pick one of the people listed", "That owner or investor no longer exists.");
    const same = existing?.holder && String(existing.holder) === input.holderId;
    if (holder.archivedAt && !same) throw invalid("holderId", "Restore them first", `${holder.name} is archived. Restore them before recording anything new.`);
    if (type === "drawing" && holder.kind !== "owner") throw invalid("holderId", "Only owners take drawings", "Drawings are for owners. Money returned to an investor is not a drawing.");
    fields.holder = holder._id;
    if (type === "capital") {
      if (holder.kind === "investor") fields.instrument = input.instrument ?? (holder.instrument as InvestorInstrument | undefined) ?? undefined;
      fields.initial = input.initial ?? !(await hasEarlierCapital(holder._id, input.date, existing?.id));
    }
  } else if (type === "capital" || type === "drawing") {
    throw invalid("holderId", type === "drawing" ? "Pick the owner" : "Pick who put the money in");
  }

  if (isMoneyEntry(type)) {
    const method = input.paymentMethod ?? "bank_transfer";
    if (!EQUITY_PAYMENT_VALUES.includes(method)) throw invalid("paymentMethod", "Pick how the money moved");
    fields.paymentMethod = method;
    // Money through the group company lands on what is owed to it, never in one of our accounts.
    if (input.accountId && method !== "biios_startup_llp") {
      if (!Types.ObjectId.isValid(input.accountId)) throw invalid("accountId", "Pick one of the accounts listed");
      const account = await BankAccount.findById(input.accountId, { archivedAt: 1, name: 1 }).lean();
      if (!account) throw invalid("accountId", "Pick one of the accounts listed", "That bank or cash account no longer exists.");
      const same = existing?.account && String(existing.account) === input.accountId;
      if (account.archivedAt && !same) throw invalid("accountId", "That account is closed", `${account.name} is closed. Pick an open account.`);
      fields.account = account._id;
    }
  }

  if (type === "reserve_transfer") {
    const key = clean(input.reserveGroup);
    if (!key) throw invalid("reserveGroup", "Pick the reserve");
    if (!(await reserveGroupKeys()).includes(key)) throw invalid("reserveGroup", "Pick one of the reserves listed");
    fields.reserveGroup = key;
  }
  return fields;
}

/** True when the holder already put capital in on or before `date` (other than the entry being edited). */
async function hasEarlierCapital(holder: Types.ObjectId, date: Date, exceptId?: string): Promise<boolean> {
  const found = await CapitalEntry.exists({
    holder,
    type: "capital",
    date: { $lte: date },
    ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}),
  });
  return Boolean(found);
}

/**
 * Records capital introduced, a drawing, a dividend, a transfer to a reserve or the retained
 * earnings before the books started. Throws AppError (with field errors) when a rule is broken.
 */
export async function createCapitalEntry(input: CapitalEntryInput, userId: string): Promise<{ id: string; number: string }> {
  await connectDB();
  const fields = await prepareEntry(input);
  if (input.bankTransactionId && !Types.ObjectId.isValid(input.bankTransactionId)) throw invalid("bankTransactionId", "Invalid statement line");
  const number = await nextNumber("capital", undefined, fields.date);
  const created = await CapitalEntry.create({
    ...fields,
    type: input.type,
    number,
    ...(input.bankTransactionId ? { bankTransaction: new Types.ObjectId(input.bankTransactionId) } : {}),
    createdBy: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
  });
  return { id: String(created._id), number };
}

/** Changes an entry's form fields in place. Its number, type and statement link never change. */
export async function updateCapitalEntry(id: string, input: Omit<CapitalEntryInput, "bankTransactionId" | "type">): Promise<void> {
  await connectDB();
  const existing = Types.ObjectId.isValid(id) ? await CapitalEntry.findById(id, { type: 1, holder: 1, account: 1 }).lean() : null;
  if (!existing) throw notFound("The equity entry");
  const fields = await prepareEntry({ ...input, type: existing.type as CapitalEntryType }, { id, holder: existing.holder, account: existing.account });
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  const keys: (keyof EntryFields)[] = ["holder", "date", "amount", "initial", "instrument", "reserveGroup", "paymentMethod", "account", "reference", "purpose", "notes"];
  for (const key of keys) {
    if (fields[key] === undefined) unset[key] = 1;
    else set[key] = fields[key];
  }
  await CapitalEntry.updateOne({ _id: existing._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
}
