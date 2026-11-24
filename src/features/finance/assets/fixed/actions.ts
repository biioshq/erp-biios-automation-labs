"use server";

import { Types, type ClientSession } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { runAtomic, type UnitOfWork } from "@/server/db";
import { BankAccount, Employee, Expense, FileModel, FixedAsset, Project, type FixedAssetDoc } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { assertGroupUnder } from "@/server/finance-groups";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { endOfDayIST, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import type { PaymentMethod } from "@/lib/constants";
import { labelsFor } from "./labels";
import {
  assetFormSchema,
  assetIdSchema,
  attachDocumentsSchema,
  deleteAssetSchema,
  disposalFormSchema,
  linkableExpenseSearchSchema,
  maintenanceFormSchema,
  maintenanceIdSchema,
  removeDocumentSchema,
  updateAssetSchema,
  type AssetFormValues,
} from "./schemas";
import { findLinkableExpenses, getAsset } from "./queries";
import { NOT_LINKABLE_SOURCES, billNote, isDeletableBill, isOwnBill } from "./server";
import type { AssetDetail } from "./types";

// Equipment flags and project allocations feed the analytics pages too.
const REVALIDATE: [string, "layout"][] = [
  ["/finance", "layout"],
  ["/analytics", "layout"],
];

const oid = (id: string) => new Types.ObjectId(id);
const unlinked = (assetId: Types.ObjectId) => ({ $or: [{ capitalAsset: { $exists: false } }, { capitalAsset: null }, { capitalAsset: assetId }] });

function assertNotFuture(value: string, field: string, what: string) {
  if (fromDateInput(value).getTime() > endOfDayIST().getTime()) {
    throw new AppError(`${what} cannot be in the future.`, "invalid", { [field]: ["Cannot be in the future"] });
  }
}

/** Employee, project and account picked in the form must exist. */
async function assertRefs(v: { assignedToId?: string; projectId?: string; accountId?: string }) {
  const [employee, project, account] = await Promise.all([
    v.assignedToId ? Employee.exists({ _id: oid(v.assignedToId) }) : true,
    v.projectId ? Project.exists({ _id: oid(v.projectId) }) : true,
    v.accountId ? BankAccount.exists({ _id: oid(v.accountId) }) : true,
  ]);
  if (!employee) throw new AppError("That employee was not found.", "invalid", { assignedToId: ["Pick someone from the list"] });
  if (!project) throw new AppError("That project was not found.", "invalid", { projectId: ["Pick a project from the list"] });
  if (!account) throw new AppError("That account was not found.", "invalid", { "funding.accountId": ["Pick an account from the list"], accountId: ["Pick an account from the list"] });
}

async function assertFilesFree(fileIds: string[] | undefined, user: SessionUser, assetId: string | null) {
  for (const id of fileIds ?? []) {
    if (!(await isClaimableFile(id, assetId, { uploadedBy: user.id }))) {
      throw new AppError("A document can't be used here. Upload it again.", "conflict", { documentIds: ["Upload the document again"] });
    }
  }
}

/** The form's fields as stored. Undefined values are unset on update. */
function toFields(v: AssetFormValues) {
  return {
    name: v.name,
    group: v.group,
    description: v.description,
    quantity: v.quantity,
    purchaseDate: fromDateInput(v.purchaseDate),
    purchaseCost: round2(v.purchaseCost),
    salvageValue: round2(v.salvageValue ?? 0),
    usefulLifeYears: v.usefulLifeYears ?? 0,
    depreciationMethod: v.depreciationMethod,
    wdvRate: v.depreciationMethod === "wdv" ? v.wdvRate : undefined,
    depreciationStart: v.depreciationStart ? fromDateInput(v.depreciationStart) : undefined,
    vendor: v.vendor,
    invoiceNumber: v.invoiceNumber,
    location: v.location,
    department: v.department,
    assignedTo: v.assignedToId ? oid(v.assignedToId) : undefined,
    isEquipment: v.isEquipment,
    project: v.projectId ? oid(v.projectId) : undefined,
    projectUntil: v.projectId && v.projectUntil ? fromDateInput(v.projectUntil) : undefined,
    condition: v.condition,
    warrantyUntil: v.warrantyUntil ? fromDateInput(v.warrantyUntil) : undefined,
    warrantyNotes: v.warrantyNotes,
    notes: v.notes,
  };
}

/**
 * The expense must be a company expense that can stand for an asset purchase and must not already be
 * the purchase of another asset. The asset's cost can be less than the expense (GST claimed back) but
 * never more, or the cost would be counted twice. The purchase date is the expense's date: the books
 * add the asset on the expense's date, so any other date would leave the register and the balance
 * sheet apart for the days between (the "depreciation starts" date covers when it was put to use).
 */
async function assertLinkable(expenseId: string, assetId: Types.ObjectId, v: { purchaseCost: number; purchaseDate: string }, session: ClientSession | undefined) {
  const e = await Expense.findById(expenseId, { source: 1, countedAtPurchase: 1, category: 1, prepaid: 1, capitalAsset: 1, amount: 1, number: 1, date: 1 })
    .session(session ?? null)
    .lean();
  if (!e) throw new AppError("That expense was not found. It may have been deleted.", "invalid", { "funding.expenseId": ["Pick another expense"] });
  const field = (message: string) => new AppError(message, "invalid", { "funding.expenseId": [message] });
  if (NOT_LINKABLE_SOURCES.includes(e.source ?? "manual") || e.countedAtPurchase) throw field(`${e.number} comes from inventory or a loan, so it can't be an asset purchase.`);
  if (e.category === "salaries") throw field("A salary payment can't be an asset purchase.");
  if (e.prepaid?.from) throw field(`${e.number} is a prepaid expense, so it can't be an asset purchase.`);
  if (e.capitalAsset && String(e.capitalAsset) !== String(assetId)) throw field(`${e.number} already paid for another asset.`);
  const other = await FixedAsset.exists({ "funding.expense": e._id, _id: { $ne: assetId } }).session(session ?? null);
  if (other) throw field(`${e.number} already paid for another asset.`);
  if (v.purchaseCost > e.amount + 0.005) {
    throw new AppError(`The purchase cost can't be more than ${e.number}'s amount.`, "invalid", { purchaseCost: [`At most the expense amount (${e.amount})`] });
  }
  if (toDateInput(e.date) !== v.purchaseDate) {
    const day = formatDate(e.date);
    throw new AppError(`The purchase date must be ${e.number}'s date, ${day}. Use "Depreciation starts" for when it was put to use.`, "invalid", {
      purchaseDate: [`Same as the expense: ${day}`],
    });
  }
}

async function linkExpense(expenseId: string, assetId: Types.ObjectId, uow: UnitOfWork) {
  const res = await Expense.updateOne({ _id: oid(expenseId), ...unlinked(assetId) }, { $set: { capitalAsset: assetId } }, { session: uow.session });
  if (res.matchedCount !== 1) throw new AppError("That expense was just linked to another asset. Pick another one.", "conflict", { "funding.expenseId": ["Pick another expense"] });
  uow.onRollback(() => Expense.updateOne({ _id: oid(expenseId), capitalAsset: assetId }, { $unset: { capitalAsset: 1 } }));
}

async function unlinkExpense(expenseId: Types.ObjectId, assetId: Types.ObjectId, uow: UnitOfWork) {
  const res = await Expense.updateOne({ _id: expenseId, capitalAsset: assetId }, { $unset: { capitalAsset: 1 } }, { session: uow.session });
  if (res.modifiedCount) uow.onRollback(() => Expense.updateOne({ _id: expenseId }, { $set: { capitalAsset: assetId } }));
}

/** One unpaid bill for a "Not paid yet" asset: what is owed to the vendor, linked back to the asset. */
async function createBill(v: AssetFormValues, asset: { _id: Types.ObjectId; code: string }, user: SessionUser, uow: UnitOfWork) {
  const date = fromDateInput(v.purchaseDate);
  const number = await nextNumber("expense", uow.session, date);
  const [bill] = await Expense.create(
    [
      {
        number,
        vendor: v.vendor!,
        category: "equipment",
        description: `Purchase of ${v.name} (${asset.code})`.slice(0, 1000),
        amount: round2(v.purchaseCost),
        date,
        paymentMethod: "credit",
        dueDate: v.funding.dueDate ? fromDateInput(v.funding.dueDate) : undefined,
        department: v.department,
        gst: v.invoiceNumber ? { invoiceNumber: v.invoiceNumber, grandTotal: round2(v.purchaseCost) } : undefined,
        notes: billNote(asset.code),
        source: "manual",
        capitalAsset: asset._id,
        createdBy: oid(user.id),
      },
    ],
    { session: uow.session },
  );
  uow.onRollback(() => Expense.deleteOne({ _id: bill._id }));
  return bill;
}

/** Deletes the unpaid bill this asset created, when the admin asked for it and nothing was paid on it. */
async function deleteOwnBill(expenseId: Types.ObjectId, asset: { _id: Types.ObjectId; code: string }, user: SessionUser, uow: UnitOfWork) {
  if (user.role !== "admin") throw new AppError("Only an admin can delete the bill. Save without deleting it.", "forbidden");
  const bill = await Expense.findById(expenseId).session(uow.session ?? null).lean();
  if (!isDeletableBill(bill, asset)) throw new AppError("That bill has a payment or was changed, so it is kept. Save without deleting it.", "conflict");
  // A rollback puts the whole document back, link included.
  await Expense.deleteOne({ _id: bill!._id }, { session: uow.session });
  uow.onRollback(() => Expense.collection.insertOne(bill!));
}

/**
 * Works out the funding record, linking or creating the expense it points to. "Not paid yet" on an
 * asset that already has the bill it created keeps that bill: saving the form again never makes a
 * second one.
 */
async function resolveFunding(
  v: AssetFormValues,
  asset: { _id: Types.ObjectId; code: string },
  user: SessionUser,
  uow: UnitOfWork,
  current?: FixedAssetDoc["funding"],
  deleteBill = false,
) {
  const f = v.funding;
  const currentExpense = current?.mode === "expense" && current.expense ? current.expense : null;
  const currentBill = currentExpense ? await Expense.findById(currentExpense, { capitalAsset: 1, source: 1, notes: 1, number: 1 }).session(uow.session ?? null).lean() : null;
  const keepsOwnBill = f.mode === "unpaid" && isOwnBill(currentBill, asset);
  let next: { mode: "expense" | "paid" | "opening"; expense?: Types.ObjectId; paymentMethod?: PaymentMethod; account?: Types.ObjectId };
  if (f.mode === "expense" || keepsOwnBill) {
    const expenseId = keepsOwnBill ? String(currentExpense) : f.expenseId!;
    await assertLinkable(expenseId, asset._id, v, uow.session);
    if (!currentExpense || String(currentExpense) !== expenseId) await linkExpense(expenseId, asset._id, uow);
    next = { mode: "expense", expense: oid(expenseId) };
  } else if (f.mode === "unpaid") {
    const bill = await createBill(v, asset, user, uow);
    // Stored as paid through that expense: the bill carries the cost and what is owed.
    next = { mode: "expense", expense: bill._id };
  } else if (f.mode === "paid") {
    next = { mode: "paid", paymentMethod: f.paymentMethod, account: f.accountId ? oid(f.accountId) : undefined };
  } else {
    next = { mode: "opening" };
  }
  // The expense it no longer points to stops counting as this asset's cost.
  if (currentExpense && String(currentExpense) !== String(next.expense ?? "")) {
    if (deleteBill) await deleteOwnBill(currentExpense, asset, user, uow);
    else await unlinkExpense(currentExpense, asset._id, uow);
  }
  return next;
}

export const createFixedAsset = defineAction(
  assetFormSchema,
  async (input, user) => {
    const labels = labelsFor(input.kind);
    await assertGroupUnder(input.group, labels.roots);
    assertNotFuture(input.purchaseDate, "purchaseDate", "The purchase date");
    await assertRefs({ assignedToId: input.assignedToId, projectId: input.projectId, accountId: input.funding.mode === "paid" ? input.funding.accountId : undefined });
    await assertFilesFree(input.documentIds, user, null);
    if (input.condition === "disposed") throw new AppError("Record the sale or disposal from the asset once it is saved.", "invalid", { condition: ["Use Record disposal instead"] });
    const created = await runAtomic(async (uow) => {
      const _id = new Types.ObjectId();
      const code = await nextNumber("asset", uow.session);
      const funding = await resolveFunding(input, { _id, code }, user, uow);
      const fields = Object.fromEntries(Object.entries(toFields(input)).filter(([, v]) => v !== undefined));
      await FixedAsset.create([{ _id, code, kind: input.kind, ...fields, funding, createdBy: oid(user.id) }], { session: uow.session });
      return { id: String(_id), code };
    });
    if (input.documentIds?.length) await attachFiles(input.documentIds, { type: "fixed_asset", id: created.id }, input.projectId);
    return created;
  },
  { revalidate: REVALIDATE, message: "Asset added" },
);

export const updateFixedAsset = defineAction(
  updateAssetSchema,
  async (input, user) => {
    const existing = await FixedAsset.findById(input.id).lean();
    if (!existing) throw notFound("The asset");
    const kind = existing.kind === "intangible" ? "intangible" : "tangible";
    await assertGroupUnder(input.group, labelsFor(kind).roots);
    assertNotFuture(input.purchaseDate, "purchaseDate", "The purchase date");
    await assertRefs({ assignedToId: input.assignedToId, projectId: input.projectId, accountId: input.funding.mode === "paid" ? input.funding.accountId : undefined });
    await assertFilesFree(input.documentIds, user, input.id);
    if (input.condition === "disposed" && !existing.disposal?.date) {
      throw new AppError("Record the sale or disposal instead, so it leaves the books.", "invalid", { condition: ["Use Record disposal instead"] });
    }
    if (existing.disposal?.date && fromDateInput(input.purchaseDate).getTime() > existing.disposal.date.getTime()) {
      throw new AppError("The purchase date can't be after the disposal date.", "invalid", { purchaseDate: ["After the disposal date"] });
    }
    await runAtomic(async (uow) => {
      const funding = await resolveFunding(input, { _id: existing._id, code: existing.code }, user, uow, existing.funding, input.deleteBill);
      const fields = toFields(input);
      const entries = Object.entries(fields);
      // Only the form's fields change: maintenance, disposal, code and kind are kept as they are.
      await FixedAsset.updateOne(
        { _id: existing._id },
        {
          $set: { ...Object.fromEntries(entries.filter(([, v]) => v !== undefined)), funding },
          $unset: Object.fromEntries(entries.filter(([, v]) => v === undefined).map(([k]) => [k, 1 as const])),
        },
        { session: uow.session },
      );
    });
    if (input.documentIds?.length) await attachFiles(input.documentIds, { type: "fixed_asset", id: input.id }, input.projectId);
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Asset updated" },
);

/** Adds or edits a maintenance entry; can book its cost as a normal expense so it is entered once. */
export const saveMaintenance = defineAction(
  maintenanceFormSchema,
  async (input, user) => {
    const asset = await FixedAsset.findById(input.assetId, { code: 1, name: 1, department: 1, maintenance: 1, purchaseDate: 1 }).lean();
    if (!asset) throw notFound("The asset");
    const entry = input.entryId ? asset.maintenance?.find((m) => String(m._id) === input.entryId) : undefined;
    if (input.entryId && !entry) throw notFound("The maintenance entry");
    assertNotFuture(input.date, "date", "The service date");
    await assertRefs({ accountId: input.accountId });
    const date = fromDateInput(input.date);
    if (date.getTime() < asset.purchaseDate.getTime()) throw new AppError("The service date can't be before the purchase date.", "invalid", { date: ["Before the purchase date"] });
    const bookExpense = input.recordExpense && !entry?.expense;

    await runAtomic(async (uow) => {
      let expenseId: Types.ObjectId | undefined;
      if (bookExpense) {
        const number = await nextNumber("expense", uow.session, date);
        const [expense] = await Expense.create(
          [
            {
              number,
              vendor: input.vendor!,
              category: "maintenance",
              description: `Maintenance of ${asset.code} ${asset.name}: ${input.description}`.slice(0, 1000),
              amount: round2(input.cost),
              date,
              paymentMethod: input.paymentMethod!,
              account: input.paymentMethod !== "credit" && input.accountId ? oid(input.accountId) : undefined,
              department: asset.department ?? undefined,
              source: "manual",
              createdBy: oid(user.id),
            },
          ],
          { session: uow.session },
        );
        expenseId = expense._id;
        uow.onRollback(() => Expense.deleteOne({ _id: expense._id }));
      }
      const values = {
        date,
        description: input.description,
        // A booked entry's cost is its expense's amount; it changes in Expenses, not here.
        cost: entry?.expense ? (entry.cost ?? 0) : round2(input.cost),
        vendor: input.vendor,
        nextDueDate: input.nextDueDate ? fromDateInput(input.nextDueDate) : undefined,
      };
      if (!entry) {
        await FixedAsset.updateOne(
          { _id: asset._id },
          { $push: { maintenance: { ...values, ...(expenseId ? { expense: expenseId } : {}), createdBy: oid(user.id) } } },
          { session: uow.session },
        );
        return;
      }
      const set: Record<string, unknown> = {};
      const unset: Record<string, 1> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v === undefined) unset[`maintenance.$.${k}`] = 1;
        else set[`maintenance.$.${k}`] = v;
      }
      if (expenseId) set["maintenance.$.expense"] = expenseId;
      await FixedAsset.updateOne({ _id: asset._id, "maintenance._id": entry._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { session: uow.session });
    });
    return { id: input.assetId };
  },
  { revalidate: REVALIDATE, message: "Maintenance saved" },
);

/** Removes a maintenance entry. An expense booked from it stays in Expenses. Admins only. */
export const deleteMaintenance = defineAction(
  maintenanceIdSchema,
  async ({ assetId, entryId }) => {
    const res = await FixedAsset.updateOne({ _id: oid(assetId), "maintenance._id": oid(entryId) }, { $pull: { maintenance: { _id: oid(entryId) } } });
    if (!res.matchedCount) throw notFound("The maintenance entry");
    return { id: assetId };
  },
  { revalidate: REVALIDATE, message: "Maintenance entry removed", role: "admin" },
);

/** Records a sale, scrapping or loss. The asset leaves the books on that date; gain or loss is the proceeds less the book value. */
export const recordDisposal = defineAction(
  disposalFormSchema,
  async (input) => {
    const asset = await FixedAsset.findById(input.id, { purchaseDate: 1, condition: 1, disposal: 1 }).lean();
    if (!asset) throw notFound("The asset");
    assertNotFuture(input.date, "date", "The disposal date");
    // The condition to put back if this disposal is removed. Recording it again over an earlier
    // disposal keeps the condition from before that one; "disposed" itself is never kept.
    const previous = asset.disposal?.previousCondition ?? asset.condition;
    const previousCondition = previous && previous !== "disposed" ? previous : undefined;
    const date = fromDateInput(input.date);
    if (date.getTime() < asset.purchaseDate.getTime()) throw new AppError("The disposal date can't be before the purchase date.", "invalid", { date: ["Before the purchase date"] });
    await assertRefs({ accountId: input.accountId });
    await FixedAsset.updateOne(
      { _id: asset._id },
      {
        $set: {
          disposal: {
            date,
            amount: round2(input.amount),
            ...(input.accountId ? { account: oid(input.accountId) } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
            ...(previousCondition ? { previousCondition } : {}),
          },
          condition: asset.condition === "lost" ? "lost" : "disposed",
        },
      },
    );
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Disposal recorded" },
);

/** Takes a disposal back (entered by mistake): the asset returns to the books. Admins only. */
export const removeDisposal = defineAction(
  assetIdSchema,
  async ({ id }) => {
    const asset = await FixedAsset.findById(id, { condition: 1, archivedAt: 1, disposal: 1 }).lean();
    if (!asset) throw notFound("The asset");
    if (!asset.disposal?.date) throw new AppError("No disposal is recorded on this asset.", "conflict");
    if (asset.archivedAt) throw new AppError("Restore the asset from the archive first.", "conflict");
    // The condition from before the disposal comes back; disposals recorded before it was kept fall back to "good".
    const restored = asset.disposal.previousCondition && asset.disposal.previousCondition !== "disposed" ? asset.disposal.previousCondition : "good";
    await FixedAsset.updateOne({ _id: asset._id }, { $unset: { disposal: 1 }, ...(asset.condition === "disposed" ? { $set: { condition: restored } } : {}) });
    return { id };
  },
  { revalidate: REVALIDATE, message: "Disposal removed", role: "admin" },
);

/**
 * Hides a disposed asset from the register. Only disposed ones: the balance sheet counts every asset
 * still held, so an archived asset must already be out of the books.
 */
export const archiveFixedAsset = defineAction(
  assetIdSchema,
  async ({ id }) => {
    const asset = await FixedAsset.findById(id, { disposal: 1 }).lean();
    if (!asset) throw notFound("The asset");
    if (!asset.disposal?.date) throw new AppError("Record the sale or disposal first, so the asset leaves the books. Then archive it.", "conflict");
    await FixedAsset.updateOne({ _id: asset._id }, { $set: { archivedAt: new Date() } });
    return { id };
  },
  { revalidate: REVALIDATE, message: "Asset archived" },
);

export const restoreFixedAsset = defineAction(
  assetIdSchema,
  async ({ id }) => {
    const res = await FixedAsset.updateOne({ _id: oid(id) }, { $set: { archivedAt: null } });
    if (!res.matchedCount) throw notFound("The asset");
    return { id };
  },
  { revalidate: REVALIDATE, message: "Asset restored" },
);

/**
 * Deletes an asset for good. The expense that paid for it is unlinked, never deleted, except the
 * unpaid bill the asset form created, when the admin asks for it and nothing was paid on it.
 * Maintenance expenses stay. The asset's own documents are removed. Admins only.
 */
export const deleteFixedAsset = defineAction(
  deleteAssetSchema,
  async ({ id, deleteBill }) => {
    const asset = await FixedAsset.findById(id).lean();
    if (!asset) throw notFound("The asset");
    await runAtomic(async (uow) => {
      if (deleteBill && asset.funding?.expense) {
        const bill = await Expense.findById(asset.funding.expense).session(uow.session ?? null).lean();
        if (!isDeletableBill(bill, asset)) throw new AppError("That bill has a payment or was changed, so it is kept. Delete the asset without it.", "conflict");
        await Expense.deleteOne({ _id: bill!._id }, { session: uow.session });
        uow.onRollback(() => Expense.collection.insertOne(bill!));
      }
      const linked = await Expense.find({ capitalAsset: asset._id }, { _id: 1 }).session(uow.session ?? null).lean();
      for (const e of linked) await unlinkExpense(e._id, asset._id, uow);
      await FixedAsset.deleteOne({ _id: asset._id }, { session: uow.session });
    });
    const files = await FileModel.find({ "entity.type": "fixed_asset", "entity.id": asset._id }, { _id: 1 }).lean();
    for (const f of files) await removeFile(String(f._id));
    return { id };
  },
  { revalidate: REVALIDATE, message: "Asset deleted", role: "admin" },
);

/** Files uploaded from the detail view (invoice, warranty card, photos). */
export const attachAssetDocuments = defineAction(
  attachDocumentsSchema,
  async ({ id, fileIds }, user) => {
    const asset = await FixedAsset.findById(id, { project: 1 }).lean();
    if (!asset) throw notFound("The asset");
    await assertFilesFree(fileIds, user, id);
    await attachFiles(fileIds, { type: "fixed_asset", id }, asset.project ? String(asset.project) : null);
    return { id };
  },
  { revalidate: REVALIDATE, message: "Document added" },
);

/** Deletes one of the asset's documents. Admins only, like every delete. */
export const removeAssetDocument = defineAction(
  removeDocumentSchema,
  async ({ id, fileId }) => {
    const file = await FileModel.exists({ _id: oid(fileId), "entity.type": "fixed_asset", "entity.id": oid(id) });
    if (!file) throw notFound("The document");
    await removeFile(fileId);
    return { id };
  },
  { revalidate: REVALIDATE, message: "Document removed", role: "admin" },
);

export const searchLinkableExpenses = defineAction(linkableExpenseSearchSchema, async ({ q, assetId }) => findLinkableExpenses(q, assetId), { readOnly: true });

/** Loads one asset for the detail drawer and the edit form. */
export async function fetchFixedAsset(id: string): Promise<AssetDetail | null> {
  if (!(await getCurrentUser())) return null;
  return getAsset(id);
}

/** Removes an upload that was never saved with an asset (form cancelled or file removed before saving). */
export async function discardUnsavedAssetFile(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
