"use server";

import { defineAction } from "@/server/action";
import { Expense } from "@/server/models";
import { recordWastage } from "@/server/services/inventory-ledger";
import { fromDateInput } from "@/lib/dates";
import { wastageFormSchema } from "./schemas";
import type { WastageResult } from "./types";

/** Wastage changes stock value and can book an expense, so Finance and Analytics refresh too. */
const REVALIDATE: [string, "layout"][] = [
  ["/inventory", "layout"],
  ["/finance", "layout"],
  ["/analytics", "layout"],
];

/** Recording wastage needs the wastage create permission (members have it): a fact from the floor, recorded with who and why. */
export const recordWastageAction = defineAction(
  wastageFormSchema,
  async (input, user): Promise<WastageResult> => {
    const result = await recordWastage(
      {
        itemId: input.itemId,
        quantity: input.quantity,
        from: input.from,
        projectId: input.from === "project" ? input.projectId : undefined,
        reason: input.reason,
        department: input.department,
        location: input.location,
        responsible: input.responsible,
        date: fromDateInput(input.date),
        note: input.note,
      },
      user.id,
    );
    const expense = result.expenseId ? await Expense.findById(result.expenseId, { number: 1 }).lean() : null;
    return {
      itemName: result.item.name,
      unit: result.item.unit ?? "pcs",
      quantity: result.movement.quantity,
      value: result.value,
      from: input.from,
      projectName: result.project?.name ?? null,
      expenseNumber: expense?.number ?? null,
      expenseAmount: result.expenseAmount,
      available: result.item.available,
    };
  },
  { permission: "inventory.wastage:create", revalidate: REVALIDATE },
);
