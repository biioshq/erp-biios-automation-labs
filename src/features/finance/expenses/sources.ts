import type { ExpenseSource } from "@/lib/constants";

/**
 * Which expenses are edited by hand and which belong to another record. Client-safe, so the list,
 * the drawer and the server actions apply the same rules.
 */

/** Expenses created by inventory: edited through their purchase or assignment, never by hand. */
export const isInventoryExpense = (source: ExpenseSource) => source === "inventory_assignment" || source === "inventory_purchase";

/**
 * Generated expenses: a stock purchase, a stock assignment, stock wastage or loan interest. They
 * change only through the record that made them, so they cannot be edited or deleted here.
 */
export const isGeneratedExpense = (source: ExpenseSource) =>
  isInventoryExpense(source) || source === "inventory_wastage" || source === "liability_interest";

/**
 * Payments can be recorded against hand-made and recurring expenses, and against a stock purchase
 * bought on credit. Assignments and wastage move no money, and loan interest is paid through the loan.
 */
export const takesPayments = (source: ExpenseSource) => !isGeneratedExpense(source) || source === "inventory_purchase";

/** Why a generated expense cannot be edited here, in one sentence. */
export function generatedNote(source: ExpenseSource): string {
  switch (source) {
    case "inventory_purchase":
      return "Created by a stock purchase. It changes only through inventory; payments can still be recorded here.";
    case "inventory_assignment":
      return "Created by an inventory assignment. Return stock to change it.";
    case "inventory_wastage":
      return "Created when stock was written off as wasted. It changes only through inventory.";
    case "liability_interest":
      return "The interest part of a loan repayment. It changes only through the loan.";
    default:
      return "";
  }
}
