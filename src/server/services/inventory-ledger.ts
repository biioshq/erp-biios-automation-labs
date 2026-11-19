import "server-only";

import { Types } from "mongoose";
import { runAtomic, type UnitOfWork } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import {
  Expense,
  InventoryAllocation,
  InventoryItem,
  InventoryMovement,
  Project,
  type InventoryItemDoc,
} from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { notifyStockLevel } from "@/server/services/notifications";
import { formatNumber, round2 } from "@/lib/format";
import type { ProjectStage } from "@/lib/constants";

/**
 * The inventory ledger: the only code that changes stock levels.
 *
 *   Purchase stock      available ↑, quantity ↑, weighted average cost updated
 *   Assign to project   available ↓, allocated ↑, allocation + project expense created
 *   Return from project available ↑, allocated ↓, allocation + expense reduced (latest first)
 *   Adjust              available ± (count corrections, damage, found stock)
 *
 * Every call records an inventory movement with the balances after it, so the
 * stock history is complete. Stock checks are conditional atomic updates
 * (`available >= qty`), so concurrent requests can never oversell.
 */

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/**
 * Quantities may be decimal (kg, m, l). Plain doubles drift (0.3 - 0.1 is
 * 0.19999999999999998), which would leave stock the UI shows as 0.2 that can
 * never be assigned or returned. So quantities are kept to 3 decimals: inputs
 * are rounded here, every balance is written with a rounding pipeline, and the
 * guards allow for drift that older writes already stored.
 */
const QTY_EPS = 1e-9;
export const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * The weighted average cost per unit, kept to 6 decimals rather than paise: a
 * 2-decimal average on cheap units (₹0.525 a gram) would value 2,000 g at
 * ₹1,060 when ₹1,050 was paid. Only money totals are rounded to paise.
 */
const roundPrice = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/**
 * An update pipeline that adds to quantity fields and rounds each result to 3
 * decimals (the `+ 0` turns a rounded -0 into 0), plus literal values to set.
 * Run it with `{ updatePipeline: true }`.
 */
function addQty(deltas: Record<string, number>, set: Record<string, unknown> = {}) {
  const $set: Record<string, unknown> = {};
  for (const [field, delta] of Object.entries(deltas)) {
    $set[field] = { $add: [{ $round: [{ $add: [`$${field}`, delta] }, 3] }, 0] };
  }
  // $literal keeps a value such as a vendor name starting with "$" from being read as a field path.
  for (const [field, value] of Object.entries(set)) if (value !== undefined) $set[field] = { $literal: value };
  return [{ $set }];
}

type ItemSnapshot = Pick<InventoryItemDoc, "_id" | "name" | "sku" | "unit" | "available" | "allocated" | "quantity" | "minStock" | "unitPrice">;

function balanceOf(item: ItemSnapshot) {
  return { available: item.available, allocated: item.allocated, quantity: item.quantity };
}

async function loadItem(itemId: string, uow?: UnitOfWork) {
  if (!Types.ObjectId.isValid(itemId)) throw notFound("The inventory item");
  const item = await InventoryItem.findById(itemId, null, { session: uow?.session }).lean();
  if (!item || item.archivedAt) throw notFound("The inventory item");
  return item;
}

async function loadOpenProject(projectId: string, uow: UnitOfWork) {
  if (!Types.ObjectId.isValid(projectId)) throw notFound("The project");
  const project = await Project.findById(projectId, null, { session: uow.session }).lean();
  if (!project) throw notFound("The project");
  if (project.status === "cancelled" || project.status === "completed") {
    throw new AppError(`${project.name} is ${project.status}. Reopen it before assigning stock.`, "conflict");
  }
  return project;
}

/* Purchase */

export type PurchaseStockInput = {
  itemId: string;
  quantity: number;
  unitPrice: number;
  vendor?: string;
  date: Date;
  invoice?: {
    number?: string;
    date?: Date;
    gstin?: string;
    taxableAmount?: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    cess?: number;
    hsnSac?: string;
    total?: number;
  };
  receiptFileId?: string;
  note?: string;
};

export async function purchaseStock(rawInput: PurchaseStockInput, userId: string) {
  const input = { ...rawInput, quantity: roundQty(rawInput.quantity), unitPrice: roundPrice(rawInput.unitPrice) };
  if (!(input.quantity > 0)) throw new AppError("Quantity must be more than zero.");
  if (!(input.unitPrice >= 0)) throw new AppError("Unit price cannot be negative.");

  const result = await runAtomic(async (uow) => {
    // Optimistic concurrency on the weighted average: retry if another write slipped in.
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await loadItem(input.itemId, uow);
      const onHand = before.available;
      const newAverage =
        onHand + input.quantity > 0
          ? roundPrice((onHand * before.unitPrice + input.quantity * input.unitPrice) / (onHand + input.quantity))
          : input.unitPrice;

      const after = await InventoryItem.findOneAndUpdate(
        { _id: before._id, available: before.available, unitPrice: before.unitPrice },
        addQty(
          { available: input.quantity, quantity: input.quantity },
          {
            unitPrice: newAverage,
            lastPurchasePrice: input.unitPrice,
            purchaseDate: input.date,
            vendor: input.vendor || undefined,
          },
        ),
        { returnDocument: "after", session: uow.session, updatePipeline: true },
      ).lean();
      if (!after) continue;

      uow.onRollback(() =>
        InventoryItem.updateOne(
          { _id: before._id },
          addQty({ available: -input.quantity, quantity: -input.quantity }, { unitPrice: before.unitPrice }),
          { updatePipeline: true },
        ),
      );

      const total = round2(input.quantity * input.unitPrice);
      const [movement] = await InventoryMovement.create(
        [
          {
            item: after._id,
            type: "purchase",
            quantity: input.quantity,
            availableDelta: input.quantity,
            allocatedDelta: 0,
            unitCost: input.unitPrice,
            totalCost: total,
            vendor: input.vendor,
            invoice: input.invoice
              ? { ...input.invoice, total: input.invoice.total ?? total }
              : undefined,
            receipt: input.receiptFileId ? oid(input.receiptFileId) : undefined,
            balance: balanceOf(after),
            note: input.note,
            date: input.date,
            createdBy: oid(userId),
          },
        ],
        { session: uow.session },
      );
      return { before, after, movement };
    }
    throw new AppError("This item is being updated by someone else. Please try again.", "conflict");
  });

  await notifyStockLevel(result.before, result.after);
  return { item: result.after, movement: result.movement };
}

/* Assign */

export type AssignStockInput = {
  itemId: string;
  projectId: string;
  quantity: number;
  stage: ProjectStage;
  date: Date;
  note?: string;
};

export async function assignToProject(rawInput: AssignStockInput, userId: string) {
  const input = { ...rawInput, quantity: roundQty(rawInput.quantity) };
  if (!(input.quantity > 0)) throw new AppError("Quantity must be more than zero.");

  const result = await runAtomic(async (uow) => {
    const project = await loadOpenProject(input.projectId, uow);
    const before = await loadItem(input.itemId, uow);

    if (before.available <= 0) {
      throw new AppError(`${before.name} is out of stock. Purchase stock before it can be allocated.`, "conflict");
    }

    // The guard: only succeeds while enough stock is available.
    const after = await InventoryItem.findOneAndUpdate(
      { _id: before._id, available: { $gte: input.quantity - QTY_EPS } },
      addQty({ available: -input.quantity, allocated: input.quantity }),
      { returnDocument: "after", session: uow.session, updatePipeline: true },
    ).lean();
    if (!after) {
      const fresh = await loadItem(input.itemId, uow);
      throw new AppError(
        `Only ${formatNumber(fresh.available)} ${fresh.unit} of ${fresh.name} available.`,
        "conflict",
        { quantity: [`Only ${formatNumber(fresh.available)} available`] },
      );
    }
    uow.onRollback(() =>
      InventoryItem.updateOne({ _id: before._id }, addQty({ available: input.quantity, allocated: -input.quantity }), {
        updatePipeline: true,
      }),
    );

    const unitCost = after.unitPrice;
    const totalCost = round2(input.quantity * unitCost);
    const expenseId = new Types.ObjectId();
    const allocationId = new Types.ObjectId();
    const movementId = new Types.ObjectId();

    const number = await nextNumber("expense", uow.session, input.date);
    await Expense.create(
      [
        {
          _id: expenseId,
          number,
          vendor: after.vendor || "Company stock",
          project: project._id,
          stage: input.stage,
          category: "inventory",
          description: `${formatNumber(input.quantity)} ${after.unit} × ${after.name} (${after.sku}) from inventory`,
          amount: totalCost,
          date: input.date,
          paymentMethod: "stock",
          notes: input.note,
          source: "inventory_assignment",
          item: after._id,
          allocation: allocationId,
          quantity: input.quantity,
          unitCost,
          createdBy: oid(userId),
        },
      ],
      { session: uow.session },
    );
    uow.onRollback(() => Expense.deleteOne({ _id: expenseId }));

    await InventoryAllocation.create(
      [
        {
          _id: allocationId,
          project: project._id,
          item: after._id,
          quantity: input.quantity,
          quantityAssigned: input.quantity,
          quantityReturned: 0,
          unitCost,
          stage: input.stage,
          assignedAt: input.date,
          expense: expenseId,
          movement: movementId,
          createdBy: oid(userId),
        },
      ],
      { session: uow.session },
    );
    uow.onRollback(() => InventoryAllocation.deleteOne({ _id: allocationId }));

    const [movement] = await InventoryMovement.create(
      [
        {
          _id: movementId,
          item: after._id,
          type: "assign",
          quantity: input.quantity,
          availableDelta: -input.quantity,
          allocatedDelta: input.quantity,
          project: project._id,
          stage: input.stage,
          unitCost,
          totalCost,
          expense: expenseId,
          allocation: allocationId,
          balance: balanceOf(after),
          note: input.note,
          date: input.date,
          createdBy: oid(userId),
        },
      ],
      { session: uow.session },
    );

    return { before, after, movement, project, expenseId, allocationId, totalCost };
  });

  await notifyStockLevel(result.before, result.after);
  return result;
}

/* Return */

export type ReturnStockInput = {
  itemId: string;
  projectId: string;
  quantity: number;
  date: Date;
  note?: string;
};

/** Units of an item a project currently holds. */
export async function heldByProject(itemId: string, projectId: string) {
  const [row] = await InventoryAllocation.aggregate<{ held: number }>([
    { $match: { item: oid(itemId), project: oid(projectId), quantity: { $gt: 0 } } },
    { $group: { _id: null, held: { $sum: "$quantity" } } },
  ]);
  return roundQty(row?.held ?? 0);
}

export async function returnFromProject(rawInput: ReturnStockInput, userId: string) {
  const input = { ...rawInput, quantity: roundQty(rawInput.quantity) };
  if (!(input.quantity > 0)) throw new AppError("Quantity must be more than zero.");

  const result = await runAtomic(async (uow) => {
    if (!Types.ObjectId.isValid(input.projectId)) throw notFound("The project");
    const project = await Project.findById(input.projectId, null, { session: uow.session }).lean();
    if (!project) throw notFound("The project");

    // Optimistic concurrency on the weighted average, as in purchaseStock: retry if another write slipped in.
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await loadItem(input.itemId, uow);

      const allocations = await InventoryAllocation.find(
        { item: before._id, project: project._id, quantity: { $gt: 0 } },
        null,
        { session: uow.session },
      )
        .sort({ assignedAt: -1, _id: -1 })
        .lean();
      const held = roundQty(allocations.reduce((sum, a) => sum + a.quantity, 0));
      if (input.quantity > held + QTY_EPS) {
        throw new AppError(
          `${project.name} holds only ${formatNumber(held)} ${before.unit} of ${before.name}.`,
          "conflict",
          { quantity: [`At most ${formatNumber(held)} can be returned`] },
        );
      }

      // Reduce the latest assignments first. The project is credited what each expense drops by,
      // so the credit matches the expenses to the paisa.
      let remaining = input.quantity;
      let creditedCost = 0;
      const plan: { allocation: (typeof allocations)[number]; take: number }[] = [];
      for (const allocation of allocations) {
        if (remaining <= QTY_EPS) break;
        const take = roundQty(Math.min(remaining, allocation.quantity));
        remaining = roundQty(remaining - take);
        creditedCost += round2(allocation.quantity * allocation.unitCost) - round2(roundQty(allocation.quantity - take) * allocation.unitCost);
        plan.push({ allocation, take });
      }
      creditedCost = round2(creditedCost);

      // Returned units come back at the cost the project was credited, not at today's average,
      // so stock value stays equal to what was paid for the stock on hand.
      const newAverage = roundPrice((before.available * before.unitPrice + creditedCost) / (before.available + input.quantity));

      const after = await InventoryItem.findOneAndUpdate(
        {
          _id: before._id,
          allocated: { $gte: input.quantity - QTY_EPS },
          available: before.available,
          unitPrice: before.unitPrice,
        },
        addQty({ available: input.quantity, allocated: -input.quantity }, { unitPrice: newAverage }),
        { returnDocument: "after", session: uow.session, updatePipeline: true },
      ).lean();
      if (!after) {
        const fresh = await loadItem(input.itemId, uow);
        if (fresh.allocated < input.quantity - QTY_EPS) {
          throw new AppError("Stock levels changed while returning. Please try again.", "conflict");
        }
        continue;
      }
      uow.onRollback(() =>
        InventoryItem.updateOne(
          { _id: before._id },
          addQty({ available: -input.quantity, allocated: input.quantity }, { unitPrice: before.unitPrice }),
          { updatePipeline: true },
        ),
      );

      for (const { allocation, take } of plan) {
        // Guarded so two returns racing on a server without transactions cannot both take the same units.
        const reduced = await InventoryAllocation.findOneAndUpdate(
          { _id: allocation._id, quantity: { $gte: take - QTY_EPS } },
          addQty({ quantity: -take, quantityReturned: take }),
          { returnDocument: "after", session: uow.session, updatePipeline: true },
        ).lean();
        if (!reduced) throw new AppError("Stock levels changed while returning. Please try again.", "conflict");
        const nowHeld = reduced.quantity;
        if (nowHeld <= 0) {
          await InventoryAllocation.updateOne({ _id: allocation._id }, { $unset: { expense: 1 } }, { session: uow.session });
        }
        uow.onRollback(() =>
          InventoryAllocation.updateOne(
            { _id: allocation._id },
            addQty({ quantity: take, quantityReturned: -take }, { expense: allocation.expense }),
            { updatePipeline: true },
          ),
        );

        if (allocation.expense) {
          const expense = await Expense.findById(allocation.expense, null, { session: uow.session }).lean();
          if (expense) {
            if (nowHeld <= 0) {
              await Expense.deleteOne({ _id: expense._id }, { session: uow.session });
              uow.onRollback(() => Expense.create(expense));
            } else {
              await Expense.updateOne(
                { _id: expense._id },
                {
                  $set: {
                    amount: round2(nowHeld * allocation.unitCost),
                    quantity: nowHeld,
                    description: `${formatNumber(nowHeld)} ${after.unit} × ${after.name} (${after.sku}) from inventory (${formatNumber(reduced.quantityReturned)} returned)`,
                  },
                },
                { session: uow.session },
              );
              uow.onRollback(() =>
                Expense.updateOne(
                  { _id: expense._id },
                  { $set: { amount: expense.amount, quantity: expense.quantity, description: expense.description } },
                ),
              );
            }
          }
        }
      }

      const [movement] = await InventoryMovement.create(
        [
          {
            item: after._id,
            type: "return",
            quantity: input.quantity,
            availableDelta: input.quantity,
            allocatedDelta: -input.quantity,
            project: project._id,
            unitCost: roundPrice(creditedCost / input.quantity),
            totalCost: creditedCost,
            balance: balanceOf(after),
            note: input.note,
            date: input.date,
            createdBy: oid(userId),
          },
        ],
        { session: uow.session },
      );

      return { before, after, movement, project, creditedCost };
    }
    throw new AppError("This item is being updated by someone else. Please try again.", "conflict");
  });

  await notifyStockLevel(result.before, result.after);
  return result;
}

/* Adjust */

export type AdjustStockInput = {
  itemId: string;
  /** Signed change to available stock. */
  delta: number;
  reason: string;
  date: Date;
};

export async function adjustStock(rawInput: AdjustStockInput, userId: string) {
  const input = { ...rawInput, delta: roundQty(rawInput.delta) };
  if (!Number.isFinite(input.delta) || input.delta === 0) throw new AppError("Enter a non-zero adjustment.");
  if (!input.reason?.trim()) throw new AppError("Give a reason for the adjustment.", "invalid", { reason: ["Required"] });

  const result = await runAtomic(async (uow) => {
    const before = await loadItem(input.itemId, uow);
    const after = await InventoryItem.findOneAndUpdate(
      input.delta < 0 ? { _id: before._id, available: { $gte: -input.delta - QTY_EPS } } : { _id: before._id },
      addQty({ available: input.delta, quantity: input.delta }),
      { returnDocument: "after", session: uow.session, updatePipeline: true },
    ).lean();
    if (!after) {
      throw new AppError(`Only ${formatNumber(before.available)} ${before.unit} available to remove.`, "conflict", {
        delta: [`At most ${formatNumber(before.available)}`],
      });
    }
    uow.onRollback(() =>
      InventoryItem.updateOne({ _id: before._id }, addQty({ available: -input.delta, quantity: -input.delta }), {
        updatePipeline: true,
      }),
    );

    const [movement] = await InventoryMovement.create(
      [
        {
          item: after._id,
          type: "adjustment",
          quantity: Math.abs(input.delta),
          availableDelta: input.delta,
          allocatedDelta: 0,
          unitCost: after.unitPrice,
          totalCost: round2(Math.abs(input.delta) * after.unitPrice),
          balance: balanceOf(after),
          note: input.reason,
          date: input.date,
          createdBy: oid(userId),
        },
      ],
      { session: uow.session },
    );
    return { before, after, movement };
  });

  await notifyStockLevel(result.before, result.after);
  return { item: result.after, movement: result.movement };
}

/**
 * Opening stock for a newly created item: recorded as a purchase so the
 * history starts from a real movement.
 */
export async function recordOpeningStock(
  itemId: string,
  quantity: number,
  unitPrice: number,
  vendor: string | undefined,
  date: Date,
  userId: string,
) {
  if (quantity <= 0) return null;
  return purchaseStock({ itemId, quantity, unitPrice, vendor, date, note: "Opening stock" }, userId);
}
