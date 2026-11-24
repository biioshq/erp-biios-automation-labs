import { z } from "zod";
import { DEPARTMENTS, WASTAGE_REASONS, valuesOf } from "@/lib/constants";
import { dateInput, optionalText } from "@/lib/zod";
import { stockQuantity } from "../ledger/schemas";

/** Validation shared by the wastage form (client) and its action (server). Client-safe. */

const pickId = (what: string) => z.string({ error: `Pick ${what}` }).regex(/^[a-f\d]{24}$/i, `Pick ${what}`);

export const WASTAGE_SOURCES = [
  { value: "storage", label: "From storage" },
  { value: "project", label: "In use on a project" },
] as const;
export type WastageSourceValue = (typeof WASTAGE_SOURCES)[number]["value"];

export const wastageFormSchema = z
  .object({
    from: z.enum(["storage", "project"], { error: "Pick where the stock was" }),
    projectId: z.string().optional(),
    itemId: pickId("an item"),
    quantity: stockQuantity,
    reason: z.enum(valuesOf(WASTAGE_REASONS), { error: "Pick a reason" }),
    department: z.enum(valuesOf(DEPARTMENTS)).optional(),
    location: optionalText(120),
    responsible: optionalText(160),
    date: dateInput,
    note: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.from === "project" && !/^[a-f\d]{24}$/i.test(v.projectId ?? "")) {
      ctx.addIssue({ code: "custom", path: ["projectId"], message: "Pick the project the stock was in use on" });
    }
  });
export type WastageFormInput = z.input<typeof wastageFormSchema>;
export type WastageFormValues = z.output<typeof wastageFormSchema>;

/** Filter and sort keys accepted in the URL of the wastage list. */
/** "source", not "from": `from` and `to` in the URL are the date range. */
export const WASTAGE_FILTER_KEYS = ["reason", "source", "department", "item", "project"] as const;
export const WASTAGE_SORT_KEYS = ["date", "quantity", "totalCost"] as const;
