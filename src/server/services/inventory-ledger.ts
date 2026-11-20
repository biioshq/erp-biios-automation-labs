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
import type { PaymentMethod, ProjectStage } from "@/lib/constants";
import { QTY_EPS, poolsOf, roundPrice, roundQty, splitAssignment } from "@/features/inventory/ledger/stock-cost";

/**
 * The inventory ledger: the only code that changes stock levels.
 *
 *   Purchase stock      available ↑, quantity ↑, weighted average cost updated, expense booked
 *   Assign to project   available ↓, allocated ↑, allocation + project expense created
 *   Return from project available ↑, allocated ↓, allocation + expense reduced (latest first)
 *   Adjust              available ± (count corrections, damage, found stock)
 *
 * Every call records an inventory movement with the balances after it, so the
 * stock history is complete. Stock checks are conditional atomic updates
 * (`available >= qty`), so concurrent requests can never oversell.
 *
 * When stock becomes an expense. A purchase books its cost as a company expense
 * right away (source "inventory_purchase"). Stock bought before that rule (and
 * opening stock entered as already on hand) was never expensed. The first
 * purchase under the new rule pins those units as the item's not-yet-expensed
 * lot: `unexpensedQty` units worth `unexpensedValue`, at the price they were on
 * the books at. The rest of the stock is the already-expensed lot. Each lot is
 * costed at its own price; `unitPrice` stays the overall average, so stock value
 * (available × unitPrice) is unchanged. Items with no `unexpensedQty` are
 * untracked: all their stock is not expensed yet and costed at the average,
 * exactly as before. The cost math is in src/features/inventory/ledger/stock-cost.ts.
 *
 *   Assign    takes already-expensed units first, at that lot's cost. Those make
 *             a project cost only (Expense.countedAtPurchase): it counts in the
 *             project's spend and budget but not in company totals, so nothing
 *             is counted twice. Units not expensed yet are expensed now, at what
 *             they cost, as a company expense, exactly as before. An assignment
 *             that needs both makes one allocation (and expense) of each kind.
 *   Return    reverses in kind, per allocation (latest first): a project-cost
 *             allocation only lowers the project's cost and its units go back
 *             as already expensed; a company-expense allocation lowers that
 *             expense (as before) and its units go back as not expensed yet, at
 *             the cost that expense dropped by.
 *   Adjust    never creates or reverses money. Removing stock (damage, loss)
 *             takes already-expensed units first, so stock that was not
 *             expensed yet is still expensed when it is used. Not-yet-expensed
 *             units a removal takes are remembered (`removedUnexpensedQty` and
 *             their cost). Found stock restores those first, as not expensed
 *             yet at the cost they left with, so a count correction (-3 then +3)
 *             changes nothing. Only found stock beyond that counts as already
 *             expensed (it was paid for in some purchase), at that lot's cost.
 *             Untracked items keep all stock as not expensed and the average
 *             unchanged, exactly as before (they only keep the counter, so a
 *             correction that spans the first new purchase still restores).
 *             Stock removed for good was never expensed if it was old stock,
 *             as before; bought stock was expensed when bought.
 */

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/**
 * Quantities may be decimal (kg, m, l). Plain doubles drift (0.3 - 0.1 is
 * 0.19999999999999998), which would leave stock the UI shows as 0.2 that can
 * never be assigned or returned. So quantities are kept to 3 decimals (roundQty):
 * inputs are rounded here, every balance is written with a rounding pipeline,
 * and the guards allow for drift that older writes already stored.
 *
 * The weighted average cost per unit is kept to 6 decimals rather than paise
 * (roundPrice): a 2-decimal average on cheap units (₹0.525 a gram) would value
 * 2,000 g at ₹1,060 when ₹1,050 was paid. Only money totals are rounded to paise.
 */
export { roundQty };

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

/** How a stock purchase was paid: any payment method except "stock". */
export type PurchasePaymentMethod = Exclude<PaymentMethod, "stock">;

function balanceOf(item: ItemSnapshot) {
  return { available: item.available, allocated: item.allocated, quantity: item.quantity };
}

/** The optional fields that track which stock is expensed. Missing on items bought only before the change. */
const TRACKING = ["unexpensedQty", "unexpensedValue", "removedUnexpensedQty", "removedUnexpensedValue"] as const;
type Tracking = Partial<Record<(typeof TRACKING)[number], number>>;
type TrackedItem = { available: number; unitPrice: number } & Partial<Record<(typeof TRACKING)[number], number | null>>;

const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Units on hand whose cost is not expensed yet (all of them on an untracked item). */
export const unexpensedOnHand = (item: TrackedItem) => poolsOf(item).unexpensedQty;

/** Units on hand that were expensed when bought. */
export const expensedOnHand = (item: TrackedItem) => poolsOf(item).expensedQty;

/** The change to not-yet-expensed stock between two item states, for the movement record (undefined when none). */
function unexpensedDelta(before: TrackedItem, after: TrackedItem) {
  const delta = roundQty(unexpensedOnHand(after) - unexpensedOnHand(before));
  return delta === 0 ? undefined : delta;
}

/**
 * The guard for a ledger update: the item as it was read, so the costs worked out from it still
 * hold. `null` matches a missing field, so this needs no migration and no index.
 */
function guardOf(item: InventoryItemDoc) {
  const guard: Record<string, unknown> = { _id: item._id, available: item.available, unitPrice: item.unitPrice };
  for (const field of TRACKING) guard[field] = numOrNull(item[field]);
  return guard;
}

/**
 * Undo for a ledger update: the quantity deltas reversed, and the average and every tracking field
 * put back as they were (removed again when they were missing).
 */
function undoUpdate(deltas: Record<string, number>, before: InventoryItemDoc) {
  const reversed = Object.fromEntries(Object.entries(deltas).map(([k, v]) => [k, -v]));
  const set: Record<string, unknown> = { unitPrice: before.unitPrice };
  const unset: string[] = [];
  for (const field of TRACKING) {
    const value = numOrNull(before[field]);
    if (value === null) unset.push(field);
    else set[field] = value;
  }
  const stages: Record<string, unknown>[] = addQty(reversed, set);
  if (unset.length) stages.push({ $unset: unset });
  return stages;
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
  /** How it was paid, for the expense the purchase books. Default bank transfer. */
  paymentMethod?: PurchasePaymentMethod;
  /**
   * Stock already on hand (opening stock that was not just bought): no expense is booked, and the
   * units count as not expensed yet, so they are expensed when assigned to a project.
   */
  onHand?: boolean;
};

export async function purchaseStock(rawInput: PurchaseStockInput, userId: string) {
  const input = { ...rawInput, quantity: roundQty(rawInput.quantity), unitPrice: roundPrice(rawInput.unitPrice) };
  if (!(input.quantity > 0)) throw new AppError("Quantity must be more than zero.");
  if (!(input.unitPrice >= 0)) throw new AppError("Unit price cannot be negative.");
  if ((input.paymentMethod as string | undefined) === "stock") throw new AppError("Pick how the purchase was paid.");

  const result = await runAtomic(async (uow) => {
    // Optimistic concurrency on the weighted average: retry if another write slipped in.
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await loadItem(input.itemId, uow);
      const onHand = before.available;
      const newAverage =
        onHand + input.quantity > 0
          ? roundPrice((onHand * before.unitPrice + input.quantity * input.unitPrice) / (onHand + input.quantity))
          : input.unitPrice;

      // The first purchase under the new rule pins the stock already on hand as the not-yet-expensed
      // lot, at the value it is on the books at. Stock entered as on hand joins that lot; bought stock
      // does not (its expense is booked below). An untracked item stays untracked for on-hand stock.
      const pools = poolsOf(before);
      const tracking: Tracking = {};
      if (input.onHand) {
        if (pools.tracked) {
          tracking.unexpensedQty = roundQty(pools.unexpensedQty + input.quantity);
          tracking.unexpensedValue = round2(pools.unexpensedValue + input.quantity * input.unitPrice);
        }
      } else if (!pools.tracked || numOrNull(before.unexpensedValue) === null) {
        tracking.unexpensedQty = pools.unexpensedQty;
        tracking.unexpensedValue = pools.unexpensedValue;
      }

      const deltas = { available: input.quantity, quantity: input.quantity };
      // A back-dated purchase (a CSV import, or Buy more with an old date) leaves the item's last
      // price, purchase date and vendor alone when a newer purchase already set them.
      const newest = !before.purchaseDate || new Date(input.date).getTime() >= new Date(before.purchaseDate).getTime();
      const after = await InventoryItem.findOneAndUpdate(
        guardOf(before),
        addQty(deltas, {
          unitPrice: newAverage,
          ...(newest ? { lastPurchasePrice: input.unitPrice, purchaseDate: input.date, vendor: input.vendor || undefined } : {}),
          ...tracking,
        }),
        { returnDocument: "after", session: uow.session, updatePipeline: true },
      ).lean();
      if (!after) continue;

      uow.onRollback(() => InventoryItem.updateOne({ _id: before._id }, undoUpdate(deltas, before), { updatePipeline: true }));

      const total = round2(input.quantity * input.unitPrice);
      const invoice = input.invoice ? { ...input.invoice, total: input.invoice.total ?? total } : undefined;
      // What was paid: the invoice grand total (GST included) when one was entered, else quantity × price.
      const amount = round2(invoice?.total && invoice.total > 0 ? invoice.total : total);
      const movementId = new Types.ObjectId();
      const expenseId = !input.onHand && amount > 0 ? new Types.ObjectId() : undefined;

      if (expenseId) {
        const number = await nextNumber("expense", uow.session, input.date);
        await Expense.create(
          [
            {
              _id: expenseId,
              number,
              vendor: input.vendor || before.vendor || "Stock purchase",
              category: "inventory",
              description: `${formatNumber(input.quantity)} ${after.unit ?? "pcs"} ${after.name}`,
              amount,
              date: input.date,
              paymentMethod: input.paymentMethod ?? "bank_transfer",
              notes: input.note,
              gst: invoice
                ? {
                    gstin: invoice.gstin,
                    invoiceNumber: invoice.number,
                    invoiceDate: invoice.date,
                    taxableAmount: invoice.taxableAmount ?? 0,
                    cgst: invoice.cgst ?? 0,
                    sgst: invoice.sgst ?? 0,
                    igst: invoice.igst ?? 0,
                    cess: invoice.cess ?? 0,
                    hsnSac: invoice.hsnSac,
                    grandTotal: invoice.total ?? 0,
                  }
                : undefined,
              receipt: input.receiptFileId ? oid(input.receiptFileId) : undefined,
              source: "inventory_purchase",
              item: after._id,
              movement: movementId,
              quantity: input.quantity,
              unitCost: input.unitPrice,
              createdBy: oid(userId),
            },
          ],
          { session: uow.session },
        );
        uow.onRollback(() => Expense.deleteOne({ _id: expenseId }));
      }

      const [movement] = await InventoryMovement.create(
        [
          {
            _id: movementId,
            item: after._id,
            type: "purchase",
            quantity: input.quantity,
            availableDelta: input.quantity,
            allocatedDelta: 0,
            unitCost: input.unitPrice,
            totalCost: total,
            vendor: input.vendor,
            invoice,
            receipt: input.receiptFileId ? oid(input.receiptFileId) : undefined,
            expense: expenseId,
            unexpensedDelta: unexpensedDelta(before, after),
            balance: balanceOf(after),
            note: input.note,
            date: input.date,
            createdBy: oid(userId),
          },
        ],
        { session: uow.session },
      );
      return { before, after, movement, expenseId: expenseId ?? null, expenseAmount: expenseId ? amount : 0 };
    }
    throw new AppError("This item is being updated by someone else. Please try again.", "conflict");
  });

  await notifyStockLevel(result.before, result.after);
  return { item: result.after, movement: result.movement, expenseId: result.expenseId, expenseAmount: result.expenseAmount };
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

    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await loadItem(input.itemId, uow);

      if (before.available <= 0) {
        throw new AppError(`${before.name} is out of stock. Purchase stock before it can be allocated.`, "conflict");
      }
      if (before.available < input.quantity - QTY_EPS) {
        throw new AppError(`Only ${formatNumber(before.available)} ${before.unit} of ${before.name} available.`, "conflict", {
          quantity: [`Only ${formatNumber(before.available)} available`],
        });
      }

      // Already-expensed units first (a project cost only), then units not expensed yet (a company
      // expense), each lot at its own cost. Untracked items: all at the average, as before.
      const split = splitAssignment(before, input.quantity);
      const tracking: Tracking =
        split.newUnexpensedQty === null ? {} : { unexpensedQty: split.newUnexpensedQty, unexpensedValue: split.newUnexpensedValue ?? 0 };

      // The guard: only succeeds while the stock is as read (so the split above holds) and enough is available.
      const deltas = { available: -input.quantity, allocated: input.quantity };
      const after = await InventoryItem.findOneAndUpdate(
        guardOf(before),
        addQty(deltas, { unitPrice: split.newUnitPrice, ...tracking }),
        { returnDocument: "after", session: uow.session, updatePipeline: true },
      ).lean();
      if (!after) continue;
      uow.onRollback(() => InventoryItem.updateOne({ _id: before._id }, undoUpdate(deltas, before), { updatePipeline: true }));

      const movementId = new Types.ObjectId();
      const label = (qty: number) => `${formatNumber(qty)} ${after.unit} × ${after.name} (${after.sku}) from inventory`;

      // Company expense first, so a later return (latest allocation first) lowers the project cost before it.
      const parts = [
        { quantity: split.fromUnexpensed, counted: false, unitCost: split.unexpensedUnitCost, amount: split.companyAmount },
        { quantity: split.fromExpensed, counted: true, unitCost: split.expensedUnitCost, amount: split.countedAmount },
      ].filter((p) => p.quantity > 0);

      const created: { expenseId: Types.ObjectId; allocationId: Types.ObjectId; amount: number; counted: boolean }[] = [];
      for (const part of parts) {
        const expenseId = new Types.ObjectId();
        const allocationId = new Types.ObjectId();
        const { amount, unitCost } = part;
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
              description: part.counted ? `${label(part.quantity)}, counted at purchase` : label(part.quantity),
              amount,
              date: input.date,
              paymentMethod: "stock",
              notes: input.note,
              source: "inventory_assignment",
              countedAtPurchase: part.counted ? true : undefined,
              item: after._id,
              allocation: allocationId,
              quantity: part.quantity,
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
              quantity: part.quantity,
              quantityAssigned: part.quantity,
              quantityReturned: 0,
              unitCost,
              stage: input.stage,
              assignedAt: input.date,
              expense: expenseId,
              expensedAtAssignment: part.counted ? 0 : part.quantity,
              countedAtPurchase: part.counted ? true : undefined,
              movement: movementId,
              createdBy: oid(userId),
            },
          ],
          { session: uow.session },
        );
        uow.onRollback(() => InventoryAllocation.deleteOne({ _id: allocationId }));
        created.push({ expenseId, allocationId, amount, counted: part.counted });
      }

      const totalCost = round2(created.reduce((s, c) => s + c.amount, 0));
      const primary = created[0];
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
            // One price for an untracked item, as before; the blend of both lots otherwise.
            unitCost: split.newUnexpensedQty === null ? split.unexpensedUnitCost : roundPrice(totalCost / input.quantity),
            totalCost,
            expense: primary?.expenseId,
            allocation: primary?.allocationId,
            unexpensedDelta: unexpensedDelta(before, after),
            balance: balanceOf(after),
            note: input.note,
            date: input.date,
            createdBy: oid(userId),
          },
        ],
        { session: uow.session },
      );

      return {
        before,
        after,
        movement,
        project,
        expenseId: primary?.expenseId ?? null,
        allocationId: primary?.allocationId ?? null,
        expenseIds: created.map((c) => c.expenseId),
        totalCost,
        /** Added to company expenses now (stock that was not expensed yet). */
        companyCost: round2(created.filter((c) => !c.counted).reduce((s, c) => s + c.amount, 0)),
        /** Moved into the project only: expensed when it was bought. */
        countedAtPurchaseCost: round2(created.filter((c) => c.counted).reduce((s, c) => s + c.amount, 0)),
      };
    }
    throw new AppError("This item is being updated by someone else. Please try again.", "conflict");
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
      let backUnexpensed = 0;
      let backUnexpensedValue = 0;
      const plan: { allocation: (typeof allocations)[number]; take: number }[] = [];
      for (const allocation of allocations) {
        if (remaining <= QTY_EPS) break;
        const take = roundQty(Math.min(remaining, allocation.quantity));
        remaining = roundQty(remaining - take);
        const credit = round2(allocation.quantity * allocation.unitCost) - round2(roundQty(allocation.quantity - take) * allocation.unitCost);
        creditedCost += credit;
        // Units that were expensed when assigned go back as not expensed yet, at what their expense
        // drops by (it is lowered below); units counted at purchase go back as already expensed.
        if (!allocation.countedAtPurchase) {
          backUnexpensed = roundQty(backUnexpensed + take);
          backUnexpensedValue += credit;
        }
        plan.push({ allocation, take });
      }
      creditedCost = round2(creditedCost);

      // Returned units come back at the cost the project was credited, not at today's average,
      // so stock value stays equal to what was paid for the stock on hand.
      const newAverage = roundPrice((before.available * before.unitPrice + creditedCost) / (before.available + input.quantity));
      const pools = poolsOf(before);
      const tracking: Tracking = pools.tracked
        ? {
            unexpensedQty: roundQty(pools.unexpensedQty + backUnexpensed),
            unexpensedValue: round2(pools.unexpensedValue + backUnexpensedValue),
          }
        : {};

      const deltas = { available: input.quantity, allocated: -input.quantity };
      const after = await InventoryItem.findOneAndUpdate(
        { ...guardOf(before), allocated: { $gte: input.quantity - QTY_EPS } },
        addQty(deltas, { unitPrice: newAverage, ...tracking }),
        { returnDocument: "after", session: uow.session, updatePipeline: true },
      ).lean();
      if (!after) {
        const fresh = await loadItem(input.itemId, uow);
        if (fresh.allocated < input.quantity - QTY_EPS) {
          throw new AppError("Stock levels changed while returning. Please try again.", "conflict");
        }
        continue;
      }
      uow.onRollback(() => InventoryItem.updateOne({ _id: before._id }, undoUpdate(deltas, before), { updatePipeline: true }));

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
              const suffix = allocation.countedAtPurchase ? ", counted at purchase" : "";
              await Expense.updateOne(
                { _id: expense._id },
                {
                  $set: {
                    amount: round2(nowHeld * allocation.unitCost),
                    quantity: nowHeld,
                    description: `${formatNumber(nowHeld)} ${after.unit} × ${after.name} (${after.sku}) from inventory${suffix} (${formatNumber(reduced.quantityReturned)} returned)`,
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
            unexpensedDelta: unexpensedDelta(before, after),
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

/**
 * What an adjustment does to the lots (the rule is in the header). `value` is the stock value the
 * adjustment moves, or null on an untracked item (then the movement is valued at the average, as before).
 */
function planAdjustment(before: InventoryItemDoc, delta: number): { unitPrice: number; tracking: Tracking; value: number | null } {
  const pools = poolsOf(before);
  const removedQty = Math.max(0, numOrNull(before.removedUnexpensedQty) ?? 0);
  const removedValue = Math.max(0, numOrNull(before.removedUnexpensedValue) ?? 0);
  const tracking: Tracking = {};

  if (delta < 0) {
    const qty = roundQty(-delta);
    // Already-expensed units first; on an untracked item every unit is not expensed yet.
    const fromExpensed = roundQty(Math.min(qty, pools.expensedQty));
    const fromUnexpensed = roundQty(qty - fromExpensed);
    const unexpensedOut =
      fromUnexpensed >= pools.unexpensedQty - QTY_EPS ? pools.unexpensedValue : round2(fromUnexpensed * pools.unexpensedUnitCost);
    if (fromUnexpensed > 0) {
      tracking.removedUnexpensedQty = roundQty(removedQty + fromUnexpensed);
      tracking.removedUnexpensedValue = round2(removedValue + unexpensedOut);
    }
    if (!pools.tracked) return { unitPrice: before.unitPrice, tracking, value: null };

    const value = round2(round2(fromExpensed * pools.expensedUnitCost) + unexpensedOut);
    const left = roundQty(before.available - qty);
    tracking.unexpensedQty = roundQty(Math.max(0, pools.unexpensedQty - fromUnexpensed));
    tracking.unexpensedValue = tracking.unexpensedQty <= QTY_EPS ? 0 : round2(Math.max(0, pools.unexpensedValue - unexpensedOut));
    return {
      unitPrice: left > QTY_EPS ? roundPrice(Math.max(0, (pools.totalValue - value) / left)) : before.unitPrice,
      tracking,
      value,
    };
  }

  // Found stock: the not-yet-expensed units removed earlier come back first, at the cost they left with.
  const restored = roundQty(Math.min(delta, removedQty));
  const restoredValue = restored <= 0 ? 0 : restored >= removedQty - QTY_EPS ? removedValue : round2((restored * removedValue) / removedQty);
  if (restored > 0) {
    tracking.removedUnexpensedQty = roundQty(removedQty - restored);
    tracking.removedUnexpensedValue = tracking.removedUnexpensedQty <= QTY_EPS ? 0 : round2(Math.max(0, removedValue - restoredValue));
  }
  if (!pools.tracked) return { unitPrice: before.unitPrice, tracking, value: null };

  // The rest counts as already expensed, at that lot's cost.
  const value = round2(restoredValue + round2(roundQty(delta - restored) * pools.expensedUnitCost));
  tracking.unexpensedQty = roundQty(pools.unexpensedQty + restored);
  tracking.unexpensedValue = round2(pools.unexpensedValue + restoredValue);
  return {
    unitPrice: roundPrice((pools.totalValue + value) / (Math.max(0, before.available) + delta)),
    tracking,
    value,
  };
}

export async function adjustStock(rawInput: AdjustStockInput, userId: string) {
  const input = { ...rawInput, delta: roundQty(rawInput.delta) };
  if (!Number.isFinite(input.delta) || input.delta === 0) throw new AppError("Enter a non-zero adjustment.");
  if (!input.reason?.trim()) throw new AppError("Give a reason for the adjustment.", "invalid", { reason: ["Required"] });

  const result = await runAtomic(async (uow) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await loadItem(input.itemId, uow);
      if (input.delta < 0 && before.available < -input.delta - QTY_EPS) {
        throw new AppError(`Only ${formatNumber(before.available)} ${before.unit} available to remove.`, "conflict", {
          delta: [`At most ${formatNumber(before.available)}`],
        });
      }
      const plan = planAdjustment(before, input.delta);
      const deltas = { available: input.delta, quantity: input.delta };
      const after = await InventoryItem.findOneAndUpdate(
        guardOf(before),
        addQty(deltas, { unitPrice: plan.unitPrice, ...plan.tracking }),
        { returnDocument: "after", session: uow.session, updatePipeline: true },
      ).lean();
      if (!after) continue;
      uow.onRollback(() => InventoryItem.updateOne({ _id: before._id }, undoUpdate(deltas, before), { updatePipeline: true }));

      const qty = Math.abs(input.delta);
      const [movement] = await InventoryMovement.create(
        [
          {
            item: after._id,
            type: "adjustment",
            quantity: qty,
            availableDelta: input.delta,
            allocatedDelta: 0,
            unitCost: plan.value === null ? after.unitPrice : roundPrice(plan.value / qty),
            totalCost: plan.value === null ? round2(qty * after.unitPrice) : plan.value,
            unexpensedDelta: unexpensedDelta(before, after),
            balance: balanceOf(after),
            note: input.reason,
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

/**
 * Opening stock for a newly created item, recorded as a purchase so the history starts from a real
 * movement. By default it was just bought, so its expense is booked like any purchase. With
 * `asPurchase: false` it was already on hand: no expense now, expensed when assigned.
 */
export async function recordOpeningStock(
  itemId: string,
  quantity: number,
  unitPrice: number,
  vendor: string | undefined,
  date: Date,
  userId: string,
  options: { asPurchase?: boolean; paymentMethod?: PurchasePaymentMethod } = {},
) {
  if (quantity <= 0) return null;
  const asPurchase = options.asPurchase ?? true;
  return purchaseStock(
    {
      itemId,
      quantity,
      unitPrice,
      vendor,
      date,
      paymentMethod: options.paymentMethod,
      onHand: !asPurchase,
      note: asPurchase ? "Opening stock" : "Opening stock, already on hand",
    },
    userId,
  );
}
