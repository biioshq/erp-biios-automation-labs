import { round2 } from "@/lib/format";

/**
 * The cost side of the inventory ledger, as pure functions so the assign form can preview exactly
 * what the ledger will book. No database access here.
 *
 * Stock on hand is two lots, each at its own cost:
 *   - not expensed yet: stock bought before purchases became expenses (and opening stock entered
 *     as already on hand). `unexpensedQty` units worth `unexpensedValue`.
 *   - already expensed: everything else, worth the rest of the stock value
 *     (available × unitPrice − unexpensedValue).
 * `unitPrice` stays the overall average, so stock value is available × unitPrice as before.
 * An item with no `unexpensedQty` is untracked: all of its stock is not expensed yet, at unitPrice.
 */

export const QTY_EPS = 1e-9;

/** Quantities are kept to 3 decimals (see the ledger). */
export const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Unit costs are kept to 6 decimals rather than paise. Money totals are rounded to paise. */
export const roundPrice = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

export type CostState = {
  available: number;
  unitPrice: number;
  unexpensedQty?: number | null;
  unexpensedValue?: number | null;
};

export type Pools = {
  /** False for items bought only before the change: all stock is not expensed yet. */
  tracked: boolean;
  totalValue: number;
  unexpensedQty: number;
  unexpensedValue: number;
  unexpensedUnitCost: number;
  expensedQty: number;
  expensedUnitCost: number;
};

/** The two lots of an item's stock on hand. */
export function poolsOf(item: CostState): Pools {
  const available = Math.max(0, item.available);
  const totalValue = available * item.unitPrice;
  const tracked = typeof item.unexpensedQty === "number";
  const unexpensedQty = roundQty(tracked ? Math.min(Math.max(0, item.unexpensedQty as number), available) : available);
  // Tracked items written before the lot value existed fall back to the average.
  const storedValue = typeof item.unexpensedValue === "number" ? item.unexpensedValue : round2(unexpensedQty * item.unitPrice);
  const unexpensedValue = !tracked
    ? round2(totalValue)
    : unexpensedQty <= QTY_EPS
      ? 0
      : round2(Math.min(Math.max(0, storedValue), totalValue));
  const expensedQty = roundQty(Math.max(0, available - unexpensedQty));
  return {
    tracked,
    totalValue,
    unexpensedQty,
    unexpensedValue,
    unexpensedUnitCost: !tracked ? item.unitPrice : unexpensedQty > QTY_EPS ? roundPrice(unexpensedValue / unexpensedQty) : item.unitPrice,
    expensedQty,
    expensedUnitCost: expensedQty > QTY_EPS ? roundPrice(Math.max(0, (totalValue - unexpensedValue) / expensedQty)) : item.unitPrice,
  };
}

export type AssignmentSplit = {
  /** Units already expensed at purchase: a project cost only. */
  fromExpensed: number;
  expensedUnitCost: number;
  /** Project cost of those units, not added to company expenses. */
  countedAmount: number;
  /** Units not expensed yet: expensed now, as a company expense. */
  fromUnexpensed: number;
  unexpensedUnitCost: number;
  /** Added to company expenses now. */
  companyAmount: number;
  total: number;
  /** The item's average cost per unit after the assignment. */
  newUnitPrice: number;
  /** The not-yet-expensed lot after the assignment (tracked items only). */
  newUnexpensedQty: number | null;
  newUnexpensedValue: number | null;
};

/**
 * How assigning `quantity` units is costed. Already-expensed units go first, each lot at its own
 * cost. Untracked items are costed exactly as before: everything at the average, as a company expense.
 */
export function splitAssignment(item: CostState, quantity: number): AssignmentSplit {
  const qty = roundQty(quantity);
  const pools = poolsOf(item);
  if (!pools.tracked) {
    const companyAmount = round2(qty * item.unitPrice);
    return {
      fromExpensed: 0,
      expensedUnitCost: item.unitPrice,
      countedAmount: 0,
      fromUnexpensed: qty,
      unexpensedUnitCost: item.unitPrice,
      companyAmount,
      total: companyAmount,
      newUnitPrice: item.unitPrice,
      newUnexpensedQty: null,
      newUnexpensedValue: null,
    };
  }
  const fromExpensed = roundQty(Math.min(qty, pools.expensedQty));
  const fromUnexpensed = roundQty(qty - fromExpensed);
  // Each part is the quantity × its unit cost to the paisa, as the allocation and its expense keep it.
  const countedAmount = round2(fromExpensed * pools.expensedUnitCost);
  const companyAmount = round2(fromUnexpensed * pools.unexpensedUnitCost);
  const remaining = roundQty(Math.max(0, item.available) - qty);
  const newUnexpensedQty = roundQty(Math.max(0, pools.unexpensedQty - fromUnexpensed));
  return {
    fromExpensed,
    expensedUnitCost: pools.expensedUnitCost,
    countedAmount,
    fromUnexpensed,
    unexpensedUnitCost: pools.unexpensedUnitCost,
    companyAmount,
    total: round2(countedAmount + companyAmount),
    newUnitPrice:
      remaining > QTY_EPS ? roundPrice(Math.max(0, (pools.totalValue - countedAmount - companyAmount) / remaining)) : item.unitPrice,
    newUnexpensedQty,
    newUnexpensedValue: newUnexpensedQty <= QTY_EPS ? 0 : round2(Math.max(0, pools.unexpensedValue - companyAmount)),
  };
}

export type RemovalSplit = {
  /** Units already expensed when bought: writing them off books nothing more. */
  fromExpensed: number;
  /** Units never expensed: their cost (`unexpensedOut`) has not been booked yet. */
  fromUnexpensed: number;
  unexpensedOut: number;
  /** Stock value removed; null on an untracked item (then it is valued at the average). */
  value: number | null;
  newUnitPrice: number;
  /** The not-yet-expensed lot after the removal (tracked items only). */
  newUnexpensedQty: number | null;
  newUnexpensedValue: number | null;
};

/**
 * Taking `quantity` units out of storage for good (a write-off or a count correction):
 * already-expensed units first, each lot at its own cost, as an assignment takes them. The ledger
 * books exactly this, and the wastage form previews it.
 */
export function splitRemoval(item: CostState, quantity: number): RemovalSplit {
  const qty = roundQty(quantity);
  const pools = poolsOf(item);
  // On an untracked item every unit is not expensed yet.
  const fromExpensed = roundQty(Math.min(qty, pools.expensedQty));
  const fromUnexpensed = roundQty(qty - fromExpensed);
  const unexpensedOut =
    fromUnexpensed >= pools.unexpensedQty - QTY_EPS ? pools.unexpensedValue : round2(fromUnexpensed * pools.unexpensedUnitCost);
  if (!pools.tracked) {
    return { fromExpensed, fromUnexpensed, unexpensedOut, value: null, newUnitPrice: item.unitPrice, newUnexpensedQty: null, newUnexpensedValue: null };
  }
  const value = round2(round2(fromExpensed * pools.expensedUnitCost) + unexpensedOut);
  const left = roundQty(Math.max(0, item.available) - qty);
  const newUnexpensedQty = roundQty(Math.max(0, pools.unexpensedQty - fromUnexpensed));
  return {
    fromExpensed,
    fromUnexpensed,
    unexpensedOut,
    value,
    newUnitPrice: left > QTY_EPS ? roundPrice(Math.max(0, (pools.totalValue - value) / left)) : item.unitPrice,
    newUnexpensedQty,
    newUnexpensedValue: newUnexpensedQty <= QTY_EPS ? 0 : round2(Math.max(0, pools.unexpensedValue - unexpensedOut)),
  };
}
