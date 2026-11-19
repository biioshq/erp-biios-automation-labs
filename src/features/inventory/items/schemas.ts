import { z } from "zod";
import { INVENTORY_UNITS, valuesOf } from "@/lib/constants";
import { objectId, optionalDateInput, optionalMoney, optionalObjectId, optionalText, requiredText } from "@/lib/zod";

/** Validation shared by the item form (client) and the item actions (server). Client-safe. */

export const itemFormSchema = z
  .object({
    name: requiredText("Item name", 160),
    sku: z
      .string({ error: "SKU is required" })
      .trim()
      .min(1, "SKU is required")
      .max(64, "At most 64 characters")
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, numbers, dots, dashes and slashes")
      .transform((v) => v.toUpperCase()),
    categoryId: optionalObjectId,
    unit: z.enum(valuesOf(INVENTORY_UNITS), { error: "Pick a unit" }),
    minStock: optionalMoney,
    vendor: optionalText(200),
    purchaseDate: optionalDateInput,
    description: optionalText(2000),
    location: optionalText(120),
    /** Create only: recorded as the first purchase movement. */
    openingQuantity: optionalMoney,
    openingUnitPrice: optionalMoney,
  })
  .superRefine((v, ctx) => {
    if ((v.openingQuantity ?? 0) > 0 && v.openingUnitPrice === undefined) {
      ctx.addIssue({ code: "custom", path: ["openingUnitPrice"], message: "Enter the unit price of the opening stock" });
    }
  });

export type ItemFormInput = z.input<typeof itemFormSchema>;
export type ItemFormValues = z.output<typeof itemFormSchema>;

export const itemIdSchema = z.object({ id: objectId });

export const adjustFormSchema = z.object({
  direction: z.enum(["add", "remove"]),
  quantity: z.number({ error: "Enter a quantity" }).finite().positive("Must be more than zero"),
  reason: requiredText("A reason", 300),
});
export type AdjustFormInput = z.input<typeof adjustFormSchema>;
export type AdjustFormValues = z.output<typeof adjustFormSchema>;

export const adjustStockSchema = z.object({
  id: objectId,
  delta: z
    .number({ error: "Enter a quantity" })
    .finite()
    .refine((n) => n !== 0, "Enter a non-zero quantity"),
  reason: requiredText("A reason", 300),
});

export const suggestSkuSchema = z.object({ name: z.string().trim().max(160), categoryId: optionalObjectId });

/** Filter keys accepted in the URL of the items list. */
export const ITEM_FILTER_KEYS = ["status", "category", "vendor"] as const;
export const ITEM_SORT_KEYS = ["name", "sku", "available", "allocated", "minStock", "unitPrice", "value", "vendor", "updatedAt"] as const;
export const ITEM_LAYOUTS = ["table", "cards"] as const;
