"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { BankAccount, FileModel, Investment } from "@/server/models";
import { assertGroupUnder } from "@/server/finance-groups";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
import { endOfDayIST, fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import {
  investmentDocumentSchema,
  investmentDocumentsSchema,
  investmentFormSchema,
  investmentIdSchema,
  redemptionFormSchema,
  type InvestmentFormValues,
} from "./schemas";
import { INVESTMENT_ROOT, getInvestment } from "./queries";
import type { InvestmentDetail } from "./types";

/** Investments hold company money: members have none of these permissions by default. */
const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];
const CREATE = { permission: "finance.investments:create", revalidate: REVALIDATE };
const EDIT = { permission: "finance.investments:edit", revalidate: REVALIDATE };
const DELETE = { permission: "finance.investments:delete", revalidate: REVALIDATE };

const oid = (id: string) => new Types.ObjectId(id);

function assertNotFuture(value: string, field: string, what: string) {
  if (fromDateInput(value).getTime() > endOfDayIST().getTime()) {
    throw new AppError(`${what} cannot be in the future.`, "invalid", { [field]: ["Cannot be in the future"] });
  }
}

async function assertAccount(accountId: string | undefined, field = "accountId") {
  if (accountId && !(await BankAccount.exists({ _id: oid(accountId) }))) {
    throw new AppError("That account was not found.", "invalid", { [field]: ["Pick an account from the list"] });
  }
}

async function assertFilesFree(fileIds: string[] | undefined, user: SessionUser, id: string | null) {
  for (const f of fileIds ?? []) {
    if (!(await isClaimableFile(f, id, { uploadedBy: user.id }))) {
      throw new AppError("A document can't be used here. Upload it again.", "conflict", { documentIds: ["Upload the document again"] });
    }
  }
}

function toFields(v: InvestmentFormValues) {
  return {
    name: v.name,
    type: v.type,
    group: v.group,
    institution: v.institution,
    reference: v.reference,
    purchaseDate: fromDateInput(v.purchaseDate),
    amount: round2(v.amount),
    // No account means it was held before the books started (an opening balance).
    account: v.source === "account" && v.accountId ? oid(v.accountId) : undefined,
    currentValue: v.currentValue === undefined ? undefined : round2(v.currentValue),
    valuedOn: v.valuedOn ? fromDateInput(v.valuedOn) : undefined,
    interestRate: v.interestRate,
    maturityDate: v.maturityDate ? fromDateInput(v.maturityDate) : undefined,
    notes: v.notes,
  };
}

async function validate(v: InvestmentFormValues) {
  await assertGroupUnder(v.group, [INVESTMENT_ROOT]);
  assertNotFuture(v.purchaseDate, "purchaseDate", "The purchase date");
  if (v.valuedOn) assertNotFuture(v.valuedOn, "valuedOn", "The valuation date");
  await assertAccount(v.source === "account" ? v.accountId : undefined);
}

export const createInvestment = defineAction(
  investmentFormSchema,
  async (input, user) => {
    await validate(input);
    await assertFilesFree(input.documentIds, user, null);
    const fields = Object.fromEntries(Object.entries(toFields(input)).filter(([, v]) => v !== undefined));
    const created = await Investment.create({ ...fields, createdBy: oid(user.id) });
    if (input.documentIds?.length) await attachFiles(input.documentIds, { type: "investment", id: String(created._id) });
    return { id: String(created._id) };
  },
  { ...CREATE, message: "Investment added" },
);

export const updateInvestment = defineAction(
  investmentFormSchema.and(investmentIdSchema),
  async (input, user) => {
    const existing = await Investment.findById(input.id, { redemption: 1 }).lean();
    if (!existing) throw notFound("The investment");
    await validate(input);
    await assertFilesFree(input.documentIds, user, input.id);
    if (existing.redemption?.date && fromDateInput(input.purchaseDate).getTime() > existing.redemption.date.getTime()) {
      throw new AppError("The purchase date can't be after the redemption date.", "invalid", { purchaseDate: ["After the redemption date"] });
    }
    const entries = Object.entries(toFields(input));
    // Only the form's fields change; the redemption and archive state are kept.
    await Investment.updateOne(
      { _id: existing._id },
      {
        $set: Object.fromEntries(entries.filter(([, v]) => v !== undefined)),
        $unset: Object.fromEntries(entries.filter(([, v]) => v === undefined).map(([k]) => [k, 1 as const])),
      },
    );
    if (input.documentIds?.length) await attachFiles(input.documentIds, { type: "investment", id: input.id });
    return { id: input.id };
  },
  { ...EDIT, message: "Investment updated" },
);

/** Records the money that came back (sale, maturity, withdrawal). Gain or loss = amount back less cost. */
export const redeemInvestment = defineAction(
  redemptionFormSchema,
  async (input) => {
    const v = await Investment.findById(input.id, { purchaseDate: 1 }).lean();
    if (!v) throw notFound("The investment");
    assertNotFuture(input.date, "date", "The redemption date");
    const date = fromDateInput(input.date);
    if (date.getTime() < v.purchaseDate.getTime()) throw new AppError("The redemption date can't be before the purchase date.", "invalid", { date: ["Before the purchase date"] });
    await assertAccount(input.accountId);
    await Investment.updateOne(
      { _id: v._id },
      { $set: { redemption: { date, amount: round2(input.amount), ...(input.accountId ? { account: oid(input.accountId) } : {}), ...(input.notes ? { notes: input.notes } : {}) } } },
    );
    return { id: input.id };
  },
  { ...EDIT, message: "Redemption recorded" },
);

export const removeRedemption = defineAction(
  investmentIdSchema,
  async ({ id }) => {
    const v = await Investment.findById(id, { redemption: 1, archivedAt: 1 }).lean();
    if (!v) throw notFound("The investment");
    if (v.archivedAt) throw new AppError("Restore the investment from the archive first.", "conflict");
    await Investment.updateOne({ _id: v._id }, { $unset: { redemption: 1 } });
    return { id };
  },
  { ...DELETE, message: "Redemption removed" },
);

/** Only a redeemed investment can be archived: the balance sheet counts every one still held. */
export const archiveInvestment = defineAction(
  investmentIdSchema,
  async ({ id }) => {
    const v = await Investment.findById(id, { redemption: 1 }).lean();
    if (!v) throw notFound("The investment");
    if (!v.redemption?.date) throw new AppError("Record the redemption first, so it leaves the books. Then archive it.", "conflict");
    await Investment.updateOne({ _id: v._id }, { $set: { archivedAt: new Date() } });
    return { id };
  },
  { ...EDIT, message: "Investment archived" },
);

export const restoreInvestment = defineAction(
  investmentIdSchema,
  async ({ id }) => {
    const res = await Investment.updateOne({ _id: oid(id) }, { $set: { archivedAt: null } });
    if (!res.matchedCount) throw notFound("The investment");
    return { id };
  },
  { ...EDIT, message: "Investment restored" },
);

export const deleteInvestment = defineAction(
  investmentIdSchema,
  async ({ id }) => {
    const v = await Investment.findById(id, { _id: 1 }).lean();
    if (!v) throw notFound("The investment");
    await Investment.deleteOne({ _id: v._id });
    const files = await FileModel.find({ "entity.type": "investment", "entity.id": v._id }, { _id: 1 }).lean();
    for (const f of files) await removeFile(String(f._id));
    return { id };
  },
  { ...DELETE, message: "Investment deleted" },
);

export const attachInvestmentDocuments = defineAction(
  investmentDocumentsSchema,
  async ({ id, fileIds }, user) => {
    if (!(await Investment.exists({ _id: oid(id) }))) throw notFound("The investment");
    await assertFilesFree(fileIds, user, id);
    await attachFiles(fileIds, { type: "investment", id });
    return { id };
  },
  { ...EDIT, message: "Document added" },
);

export const removeInvestmentDocument = defineAction(
  investmentDocumentSchema,
  async ({ id, fileId }) => {
    const file = await FileModel.exists({ _id: oid(fileId), "entity.type": "investment", "entity.id": oid(id) });
    if (!file) throw notFound("The document");
    await removeFile(fileId);
    return { id };
  },
  { ...DELETE, message: "Document removed" },
);

export async function fetchInvestment(id: string): Promise<InvestmentDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.investments:view")) return null;
  return getInvestment(id);
}
