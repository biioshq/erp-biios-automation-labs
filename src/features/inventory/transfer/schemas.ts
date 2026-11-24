import { z } from "zod";
import { PROJECT_STAGES, valuesOf } from "@/lib/constants";
import { dateInput, optionalText } from "@/lib/zod";
import { stockQuantity } from "../ledger/schemas";

/** Validation shared by the transfer forms (client) and their actions (server). Client-safe. */

const pickId = (what: string) => z.string({ error: `Pick ${what}` }).regex(/^[a-f\d]{24}$/i, `Pick ${what}`);

export const projectMoveSchema = z
  .object({
    fromProjectId: pickId("the project the stock is on"),
    itemId: pickId("an item"),
    toProjectId: pickId("the project to move it to"),
    stage: z.enum(valuesOf(PROJECT_STAGES), { error: "Pick the stage it is used in" }),
    quantity: stockQuantity,
    date: dateInput,
    note: optionalText(1000),
  })
  .refine((v) => v.fromProjectId !== v.toProjectId, { path: ["toProjectId"], message: "Pick a different project" });
export type ProjectMoveInput = z.input<typeof projectMoveSchema>;
export type ProjectMoveValues = z.output<typeof projectMoveSchema>;

export const relocationSchema = z.object({
  itemId: pickId("an item"),
  to: z.string({ error: "Enter the new location" }).trim().min(1, "Enter the new location").max(120, "At most 120 characters"),
  date: dateInput,
  note: optionalText(1000),
});
export type RelocationInput = z.input<typeof relocationSchema>;
export type RelocationValues = z.output<typeof relocationSchema>;

export const TRANSFER_MODES = [
  { value: "project", label: "Between projects" },
  { value: "location", label: "Storage location" },
] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number]["value"];
