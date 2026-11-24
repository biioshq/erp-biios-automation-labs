"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { CapitalEntry, EquityHolder, FileModel } from "@/server/models";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { EquityHolderKind } from "@/lib/constants";
import { entryFormSchema, entryIdSchema, holderFormSchema, holderIdSchema, type EntryFormValues, type HolderFormValues } from "./schemas";
import { createCapitalEntry, updateCapitalEntry, type CapitalEntryInput } from "./server";
import { getEntry, getHolder } from "./queries";
import type { EntryDetail, HolderDetail } from "./types";

/** Capital / Equity: members have none of these permissions by default. */
const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];
const CREATE = { revalidate: REVALIDATE, permission: "finance.equity:create" };
const EDIT = { revalidate: REVALIDATE, permission: "finance.equity:edit" };
const DELETE = { revalidate: REVALIDATE, permission: "finance.equity:delete" };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Owners and investors */

async function assertUniqueName(name: string, kind: EquityHolderKind, exceptId?: string) {
  const clash = await EquityHolder.exists({
    name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    kind,
    archivedAt: null,
    ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}),
  });
  if (clash) throw new AppError(`${name} is already listed. Open their record instead of adding them again.`, "conflict", { name: ["Already listed"] });
}

/** Ownership shares of everyone still listed cannot add up to more than 100%. */
async function assertOwnershipFits(percent: number | undefined, exceptId?: string) {
  if (!percent) return;
  const others = await EquityHolder.find(
    { archivedAt: null, ownershipPercent: { $gt: 0 }, ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}) },
    { ownershipPercent: 1 },
  ).lean();
  const taken = round2(others.reduce((s, h) => s + (h.ownershipPercent ?? 0), 0));
  if (taken + percent > 100.0001) {
    const left = Math.max(0, round2(100 - taken));
    throw new AppError(`Owners and investors already hold ${taken}%. At most ${left}% is left.`, "invalid", { ownershipPercent: [`At most ${left}%`] });
  }
}

function holderFields(v: HolderFormValues) {
  return {
    name: v.name,
    kind: v.kind,
    ownershipPercent: v.ownershipPercent === undefined ? undefined : round2(v.ownershipPercent),
    instrument: v.kind === "investor" ? v.instrument : undefined,
    email: v.email,
    phone: v.phone,
    notes: v.notes,
  };
}

export const createHolder = defineAction(
  holderFormSchema,
  async (input, user) => {
    await assertUniqueName(input.name, input.kind);
    await assertOwnershipFits(input.ownershipPercent);
    const created = await EquityHolder.create({ ...holderFields(input), createdBy: new Types.ObjectId(user.id) });
    return { id: String(created._id), name: created.name };
  },
  { ...CREATE, message: "Added" },
);

export const updateHolder = defineAction(
  holderFormSchema.and(holderIdSchema),
  async (input) => {
    const existing = await EquityHolder.findById(input.id).lean();
    if (!existing) throw notFound("That owner or investor");
    if (existing.kind !== input.kind && (await CapitalEntry.exists({ holder: existing._id }))) {
      throw new AppError("They already have entries, so they stay an " + existing.kind + ". Add a separate record for the other role.", "conflict", {
        kind: ["Cannot change once entries exist"],
      });
    }
    await assertUniqueName(input.name, input.kind, input.id);
    if (!existing.archivedAt) await assertOwnershipFits(input.ownershipPercent, input.id);
    const fields = holderFields(input);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) unset[key] = 1;
      else set[key] = value;
    }
    await EquityHolder.updateOne({ _id: existing._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    return { id: input.id };
  },
  { ...EDIT, message: "Saved" },
);

/** Hides a holder from pickers. Their entries stay and keep counting. */
export const archiveHolder = defineAction(
  holderIdSchema,
  async ({ id }) => {
    const res = await EquityHolder.updateOne({ _id: new Types.ObjectId(id) }, { $set: { archivedAt: new Date() } });
    if (!res.matchedCount) throw notFound("That owner or investor");
    return { id };
  },
  { ...EDIT, message: "Archived" },
);

export const restoreHolder = defineAction(
  holderIdSchema,
  async ({ id }) => {
    const existing = await EquityHolder.findById(id).lean();
    if (!existing) throw notFound("That owner or investor");
    await assertUniqueName(existing.name, existing.kind as EquityHolderKind, id);
    await assertOwnershipFits(existing.ownershipPercent ?? undefined, id);
    await EquityHolder.updateOne({ _id: existing._id }, { $set: { archivedAt: null } });
    return { id };
  },
  { ...EDIT, message: "Restored" },
);

/** Only someone with no entries at all can be deleted; anyone else is archived instead. */
export const deleteHolder = defineAction(
  holderIdSchema,
  async ({ id }) => {
    const existing = await EquityHolder.findById(id).lean();
    if (!existing) throw notFound("That owner or investor");
    const entries = await CapitalEntry.countDocuments({ holder: existing._id });
    if (entries > 0) {
      throw new AppError(`${existing.name} has ${entries} ${entries === 1 ? "entry" : "entries"}. Archive them instead; their capital history stays.`, "conflict");
    }
    await EquityHolder.deleteOne({ _id: existing._id });
    return { id };
  },
  { ...DELETE, message: "Deleted" },
);

/* Capital entries */

/** Every document id must be a fresh upload by this user or a file already on this entry. */
async function assertUsableDocuments(ids: string[], userId: string, entryId: string | null) {
  for (const id of ids) {
    if (!(await isClaimableFile(id, entryId, { uploadedBy: userId }))) {
      throw new AppError("One of the documents can't be used here. Upload it again.", "invalid", { documentIds: ["Upload the document again"] });
    }
  }
}

function toInput(v: EntryFormValues, holderId: string | undefined): Omit<CapitalEntryInput, "type" | "bankTransactionId"> {
  return {
    holderId,
    date: fromDateInput(v.date),
    amount: v.amount,
    paymentMethod: v.paymentMethod,
    accountId: v.accountId,
    reference: v.reference,
    purpose: v.purpose,
    notes: v.notes,
    initial: v.contribution === "initial" ? true : v.contribution === "additional" ? false : undefined,
    instrument: v.instrument,
    reserveGroup: v.reserveGroup,
  };
}

export const recordEntry = defineAction(
  entryFormSchema,
  async (input, user) => {
    const documentIds = [...new Set(input.documentIds)];
    await assertUsableDocuments(documentIds, user.id, null);
    // A person typed into the form is added with the entry, and removed again if the entry is refused.
    let createdHolder: string | null = null;
    let holderId = input.holderId;
    if (!holderId && input.newHolderName && (input.type === "capital" || input.type === "drawing" || input.type === "dividend")) {
      const kind: EquityHolderKind = input.type === "drawing" ? "owner" : (input.newHolderKind ?? "owner");
      await assertUniqueName(input.newHolderName, kind).catch(() => {
        throw new AppError(`${input.newHolderName} is already listed. Pick them from the list.`, "conflict", { holderId: ["Already listed: pick them"] });
      });
      const holder = await EquityHolder.create({ name: input.newHolderName, kind, instrument: kind === "investor" ? input.instrument : undefined, createdBy: new Types.ObjectId(user.id) });
      createdHolder = String(holder._id);
      holderId = createdHolder;
    }
    let created: { id: string; number: string };
    try {
      created = await createCapitalEntry({ ...toInput(input, holderId), type: input.type }, user.id);
    } catch (error) {
      if (createdHolder) await EquityHolder.deleteOne({ _id: new Types.ObjectId(createdHolder) });
      throw error;
    }
    // Once the entry exists the new person stays: the entry points at them.
    if (documentIds.length) {
      await CapitalEntry.updateOne({ _id: new Types.ObjectId(created.id) }, { $set: { documents: documentIds.map((d) => new Types.ObjectId(d)) } });
      await attachFiles(documentIds, { type: "capital", id: created.id });
    }
    return { ...created, holderId: holderId ?? null };
  },
  { ...CREATE, message: "Recorded" },
);

export const updateEntry = defineAction(
  entryFormSchema.and(entryIdSchema),
  async (input, user) => {
    const existing = await CapitalEntry.findById(input.id, { type: 1, documents: 1 }).lean();
    if (!existing) throw notFound("The equity entry");
    if (existing.type !== input.type) throw new AppError("The type of an entry cannot change. Delete it and record a new one.", "invalid");
    const documentIds = [...new Set(input.documentIds)];
    await assertUsableDocuments(documentIds, user.id, input.id);
    await updateCapitalEntry(input.id, toInput(input, input.holderId));
    await CapitalEntry.updateOne({ _id: existing._id }, { $set: { documents: documentIds.map((d) => new Types.ObjectId(d)) } });
    if (documentIds.length) await attachFiles(documentIds, { type: "capital", id: input.id });
    // A document taken off the entry is deleted from storage (only people who can edit equity get here).
    const kept = new Set(documentIds);
    for (const old of existing.documents ?? []) if (!kept.has(String(old))) await removeFile(String(old));
    return { id: input.id };
  },
  { ...EDIT, message: "Saved" },
);

export const deleteEntry = defineAction(
  entryIdSchema,
  async ({ id }) => {
    const existing = await CapitalEntry.findById(id, { documents: 1 }).lean();
    if (!existing) throw notFound("The equity entry");
    await CapitalEntry.deleteOne({ _id: existing._id });
    for (const file of existing.documents ?? []) await removeFile(String(file));
    return { id };
  },
  { ...DELETE, message: "Deleted" },
);

/* Reads for the drawers */

export async function fetchEntry(id: string): Promise<EntryDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.equity:view")) return null;
  return getEntry(id);
}

export async function fetchHolder(id: string): Promise<HolderDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.equity:view")) return null;
  return getHolder(id);
}

/** Removes a document uploaded in a form that was then cancelled, or taken off before saving. */
export async function discardUnsavedEquityDocument(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
