"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { connectDB } from "@/server/db";
import { FileModel } from "@/server/models";
import { can, getCurrentUser } from "@/server/auth/session";
import { removeFile } from "@/features/files/server";
import { fromDateInput } from "@/lib/dates";
import {
  liabilityDocumentSchema,
  liabilityDocumentsSchema,
  liabilityFormSchema,
  liabilityIdSchema,
  repaymentFormSchema,
  repaymentRefSchema,
  type LiabilityFormValues,
} from "./schemas";
import {
  addLiabilityPayment,
  attachLiabilityDocuments,
  createLiability,
  deleteLiability,
  deleteLiabilityPayment,
  removeLiabilityDocument,
  updateLiability,
} from "./server";
import { getLiability } from "./queries";
import type { LiabilityDetail } from "./types";

/** Every action here needs its Liabilities permission (members have none by default); deletes need a confirmation in the UI. */
const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

function terms(v: LiabilityFormValues) {
  return {
    name: v.name,
    group: v.group,
    lender: v.lender,
    originalAmount: v.originalAmount,
    date: fromDateInput(v.date),
    dueDate: v.dueDate ? fromDateInput(v.dueDate) : undefined,
    interestRate: v.interestRate,
    tenureMonths: v.kind === "loan" ? v.tenureMonths : undefined,
    installment: v.kind === "loan" ? v.installment : undefined,
    source: {
      mode: v.sourceMode,
      accountId: v.sourceMode === "account" ? v.accountId : undefined,
      paymentMethod: v.sourceMode === "account" ? v.paymentMethod : undefined,
      category: v.sourceMode === "accrued" ? v.category : undefined,
    },
    reference: v.reference,
    notes: v.notes,
  };
}

export const createLiabilityAction = defineAction(
  liabilityFormSchema,
  async (input, user) => {
    const created = await createLiability({ ...terms(input), kind: input.kind }, user.id);
    if (input.documentIds.length) await attachLiabilityDocuments(created.id, input.documentIds, user.id);
    return created;
  },
  { revalidate: REVALIDATE, message: "Liability added", permission: "finance.liabilities:create" },
);

export const updateLiabilityAction = defineAction(
  liabilityFormSchema.and(liabilityIdSchema),
  async (input, user) => {
    await updateLiability({ ...terms(input), kind: input.kind, id: input.id });
    if (input.documentIds.length) await attachLiabilityDocuments(input.id, input.documentIds, user.id);
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Liability updated", permission: "finance.liabilities:edit" },
);

export const deleteLiabilityAction = defineAction(liabilityIdSchema, async ({ id }) => deleteLiability(id), {
  revalidate: REVALIDATE,
  message: "Liability deleted",
  permission: "finance.liabilities:delete",
});

export const recordRepaymentAction = defineAction(
  repaymentFormSchema,
  async (input, user) =>
    addLiabilityPayment(
      {
        liabilityId: input.liabilityId,
        date: fromDateInput(input.date),
        principal: input.principal,
        interest: input.interest,
        paymentMethod: input.paymentMethod,
        accountId: input.accountId,
        reference: input.reference,
        note: input.note,
      },
      user.id,
    ),
  { revalidate: REVALIDATE, message: "Repayment recorded", permission: "finance.liabilities:edit" },
);

export const deleteRepaymentAction = defineAction(repaymentRefSchema, async ({ liabilityId, paymentId }) => deleteLiabilityPayment(liabilityId, paymentId), {
  revalidate: REVALIDATE,
  message: "Repayment deleted",
  permission: "finance.liabilities:delete",
});

export const addLiabilityDocumentsAction = defineAction(
  liabilityDocumentsSchema,
  async ({ liabilityId, fileIds }, user) => ({ attached: await attachLiabilityDocuments(liabilityId, fileIds, user.id) }),
  { revalidate: REVALIDATE, message: "Documents added", permission: "finance.liabilities:edit" },
);

export const removeLiabilityDocumentAction = defineAction(
  liabilityDocumentSchema,
  async ({ liabilityId, fileId }) => {
    await removeLiabilityDocument(liabilityId, fileId);
    return { id: fileId };
  },
  { revalidate: REVALIDATE, message: "Document removed", permission: "finance.liabilities:delete" },
);

/** Loads one liability for the detail drawer and the edit form. Needs Liabilities view. */
export async function fetchLiability(id: string): Promise<LiabilityDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.liabilities:view")) return null;
  return getLiability(id);
}

/** Removes a document uploaded in a form that was then cancelled. Only the uploader's own unsaved files. */
export async function discardUnsavedLiabilityDocument(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !(can(user, "finance.liabilities:create") || can(user, "finance.liabilities:edit")) || !Types.ObjectId.isValid(fileId)) return;
  await connectDB();
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
