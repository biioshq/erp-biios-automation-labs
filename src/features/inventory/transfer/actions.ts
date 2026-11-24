"use server";

import { defineAction } from "@/server/action";
import { moveBetweenProjects, relocateItem } from "@/server/services/inventory-ledger";
import { fromDateInput } from "@/lib/dates";
import { projectMoveSchema, relocationSchema } from "./schemas";
import type { ProjectMoveResult, RelocationResult } from "./types";

/** A move changes two projects' expenses, so Finance and Analytics refresh along with Inventory. */
const REVALIDATE: [string, "layout"][] = [
  ["/inventory", "layout"],
  ["/finance", "layout"],
  ["/analytics", "layout"],
];

export const moveStockAction = defineAction(
  projectMoveSchema,
  async (input, user): Promise<ProjectMoveResult> => {
    const r = await moveBetweenProjects(
      {
        itemId: input.itemId,
        fromProjectId: input.fromProjectId,
        toProjectId: input.toProjectId,
        stage: input.stage,
        quantity: input.quantity,
        date: fromDateInput(input.date),
        note: input.note,
      },
      user.id,
    );
    return { itemName: r.item.name, unit: r.item.unit ?? "pcs", quantity: r.quantity, fromName: r.source.name, toName: r.target.name, value: r.credited };
  },
  { permission: "inventory.movement:create", revalidate: REVALIDATE },
);

export const relocateItemAction = defineAction(
  relocationSchema,
  async (input, user): Promise<RelocationResult> => {
    const r = await relocateItem({ itemId: input.itemId, to: input.to, date: fromDateInput(input.date), note: input.note }, user.id);
    return { itemName: r.item.name, from: r.from, to: r.to };
  },
  { permission: "inventory.movement:create", revalidate: [["/inventory", "layout"]] },
);
