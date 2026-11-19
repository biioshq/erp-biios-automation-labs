"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { connectDB } from "@/server/db";
import { Expense, FileModel } from "@/server/models";
import { assignToProject, purchaseStock, returnFromProject } from "@/server/services/inventory-ledger";
import { getCurrentUser } from "@/server/auth/session";
import { attachFiles, removeFile } from "@/features/files/server";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { gstGrandTotal } from "@/lib/gst";
import { getStockStatus } from "@/lib/stock-status";
import { assignFormSchema, purchaseFormSchema, returnFormSchema } from "./schemas";
import { getHeldItems, getProjectImpact } from "./queries";
import type { AssignResult, HeldItem, ProjectImpact, PurchaseResult, ReturnResult } from "./types";

/** Assignments create project expenses, so Finance refreshes along with Inventory. */
const REVALIDATE: [string, "layout"][] = [
  ["/inventory", "layout"],
  ["/finance", "layout"],
];

export const purchaseStockAction = defineAction(
  purchaseFormSchema,
  async (input, user): Promise<PurchaseResult> => {
    const g = input.invoice;
    const taxable = round2(g.taxableAmount ?? 0);
    const hasInvoice = Boolean(g.invoiceNumber || g.gstin || taxable > 0);
    const { item, movement } = await purchaseStock(
      {
        itemId: input.itemId,
        quantity: input.quantity,
        unitPrice: round2(input.unitPrice),
        vendor: input.vendor,
        date: fromDateInput(input.date),
        invoice: hasInvoice
          ? {
              number: g.invoiceNumber,
              date: g.invoiceDate ? fromDateInput(g.invoiceDate) : undefined,
              gstin: g.gstin,
              taxableAmount: taxable,
              cgst: round2(g.cgst ?? 0),
              sgst: round2(g.sgst ?? 0),
              igst: round2(g.igst ?? 0),
              cess: round2(g.cess ?? 0),
              hsnSac: g.hsnSac,
              total: taxable > 0 ? gstGrandTotal({ ...g, taxableAmount: taxable }) : undefined,
            }
          : undefined,
        receiptFileId: input.receiptFileId,
        note: input.note,
      },
      user.id,
    );
    if (input.receiptFileId) await attachFiles([input.receiptFileId], { type: "movement", id: String(movement._id) });
    return {
      itemName: item.name,
      unit: item.unit ?? "pcs",
      quantity: input.quantity,
      unitPrice: round2(input.unitPrice),
      total: round2(input.quantity * input.unitPrice),
      available: item.available,
      status: getStockStatus(item.available, item.minStock),
    };
  },
  { revalidate: REVALIDATE },
);

export const assignStockAction = defineAction(
  assignFormSchema,
  async (input, user): Promise<AssignResult> => {
    const result = await assignToProject(
      {
        itemId: input.itemId,
        projectId: input.projectId,
        quantity: input.quantity,
        stage: input.stage,
        date: fromDateInput(input.date),
        note: input.note,
      },
      user.id,
    );
    const expense = await Expense.findById(result.expenseId, { number: 1 }).lean();
    return {
      itemName: result.after.name,
      unit: result.after.unit ?? "pcs",
      quantity: input.quantity,
      projectName: result.project.name,
      expenseNumber: expense?.number ?? null,
      total: result.totalCost,
      available: result.after.available,
      status: getStockStatus(result.after.available, result.after.minStock),
    };
  },
  { revalidate: REVALIDATE },
);

export const returnStockAction = defineAction(
  returnFormSchema,
  async (input, user): Promise<ReturnResult> => {
    const result = await returnFromProject(
      {
        itemId: input.itemId,
        projectId: input.projectId,
        quantity: input.quantity,
        date: fromDateInput(input.date),
        note: input.note,
      },
      user.id,
    );
    return {
      itemName: result.after.name,
      unit: result.after.unit ?? "pcs",
      quantity: input.quantity,
      projectName: result.project.name,
      credited: result.creditedCost,
      available: result.after.available,
    };
  },
  { revalidate: REVALIDATE },
);

/** Items a project holds, for the return form and its credit preview. */
export async function fetchHeldItems(projectId: string): Promise<HeldItem[]> {
  if (!(await getCurrentUser())) return [];
  return getHeldItems(projectId);
}

/** Budget and spend of a project, for the assignment impact preview. */
export async function fetchProjectImpact(projectId: string): Promise<ProjectImpact | null> {
  if (!(await getCurrentUser())) return null;
  return getProjectImpact(projectId);
}

/** Removes a receipt that was uploaded but never saved with a purchase. */
export async function discardPurchaseReceipt(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  await connectDB();
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
