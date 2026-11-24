"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { connectDB } from "@/server/db";
import { Expense, FileModel } from "@/server/models";
import { assignToProject, purchaseStock, returnFromProject } from "@/server/services/inventory-ledger";
import { can, getCurrentUser } from "@/server/auth/session";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { AppError } from "@/server/errors";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { gstGrandTotal } from "@/lib/gst";
import { getStockStatus } from "@/lib/stock-status";
import { assignFormSchema, purchaseFormSchema, returnFormSchema } from "./schemas";
import { getHeldItems, getProjectImpact } from "./queries";
import type { AssignResult, HeldItem, ProjectImpact, PurchaseResult, ReturnResult } from "./types";

/** Purchases and assignments create expenses, so Finance refreshes along with Inventory. */
const REVALIDATE: [string, "layout"][] = [
  ["/inventory", "layout"],
  ["/finance", "layout"],
];

export const purchaseStockAction = defineAction(
  purchaseFormSchema,
  async (input, user): Promise<PurchaseResult> => {
    // Only a receipt this person just uploaded (or nobody owns yet): never another record's file.
    if (input.receiptFileId && !(await isClaimableFile(input.receiptFileId, null, { kind: "receipt", uploadedBy: user.id }))) {
      throw new AppError("This receipt can't be used here. Upload the file again.", "conflict");
    }
    const g = input.invoice;
    const taxable = round2(g.taxableAmount ?? 0);
    const hasInvoice = Boolean(g.invoiceNumber || g.gstin || taxable > 0);
    const { item, movement, expenseId, expenseAmount } = await purchaseStock(
      {
        itemId: input.itemId,
        quantity: input.quantity,
        // Not rounded to paise: ₹525 for 1,000 g is ₹0.525 a gram. The ledger keeps unit costs to 6 decimals.
        unitPrice: input.unitPrice,
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
        paymentMethod: input.paymentMethod,
      },
      user.id,
    );
    // The receipt belongs to the movement; the purchase expense points at the same file.
    if (input.receiptFileId) await attachFiles([input.receiptFileId], { type: "movement", id: String(movement._id) });
    const expense = expenseId ? await Expense.findById(expenseId, { number: 1 }).lean() : null;
    return {
      itemName: item.name,
      unit: item.unit ?? "pcs",
      quantity: movement.quantity,
      unitPrice: movement.unitCost ?? input.unitPrice,
      total: movement.totalCost ?? round2(input.quantity * input.unitPrice),
      available: item.available,
      status: getStockStatus(item.available, item.minStock),
      expenseNumber: expense?.number ?? null,
      expenseAmount,
    };
  },
  { permission: "inventory.purchase:create", revalidate: REVALIDATE },
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
      quantity: result.movement.quantity,
      projectName: result.project.name,
      expenseNumber: expense?.number ?? null,
      total: result.totalCost,
      companyCost: result.companyCost,
      countedAtPurchaseCost: result.countedAtPurchaseCost,
      available: result.after.available,
      status: getStockStatus(result.after.available, result.after.minStock),
    };
  },
  { permission: "inventory.movement:create", revalidate: REVALIDATE },
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
      quantity: result.movement.quantity,
      projectName: result.project.name,
      credited: result.creditedCost,
      available: result.after.available,
    };
  },
  { permission: "inventory.movement:create", revalidate: REVALIDATE },
);

/** Items a project holds, for the return, project move and wastage forms. */
export async function fetchHeldItems(projectId: string): Promise<HeldItem[]> {
  const user = await getCurrentUser();
  if (!user || !(can(user, "inventory.movement:view") || can(user, "inventory.wastage:view"))) return [];
  return getHeldItems(projectId);
}

/**
 * Budget and spend of a project, for the assign, return and project move previews. Only for people
 * who may also see project figures; everyone else gets null and the forms leave the spend rows out.
 */
export async function fetchProjectImpact(projectId: string): Promise<ProjectImpact | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "inventory.movement:view")) return null;
  if (!can(user, "finance.projects:view") && !can(user, "finance.project_finance:view")) return null;
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
