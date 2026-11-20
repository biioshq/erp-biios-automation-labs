import { z } from "zod";
import { INVENTORY_UNITS, valuesOf } from "@/lib/constants";
import { money, objectId, optionalDateInput, optionalMoney, optionalObjectId, optionalText, requiredText } from "@/lib/zod";
import { hasQtyDecimals, purchasePaymentMethod, stockQuantity } from "../ledger/schemas";
import { ATTRIBUTE_LABEL_MAX, ATTRIBUTE_VALUE_MAX, MAX_ATTRIBUTES, SUBCATEGORY_MAX, attributeKey } from "./attributes";

/** Extra details: label and value. Rows left blank in the form are dropped; labels are unique. */
export const itemAttributesSchema = z
  .array(z.object({ label: z.string().max(200).optional(), value: z.string().max(5000).optional() }))
  .max(MAX_ATTRIBUTES * 2)
  .transform((list) =>
    list.map((a) => ({ label: (a.label ?? "").replace(/\s+/g, " ").trim(), value: (a.value ?? "").trim() })).filter((a) => a.label || a.value),
  )
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((a, i) => {
      if (!a.label) ctx.addIssue({ code: "custom", path: [i, "label"], message: "Name this detail" });
      else if (a.label.length > ATTRIBUTE_LABEL_MAX) ctx.addIssue({ code: "custom", path: [i, "label"], message: `At most ${ATTRIBUTE_LABEL_MAX} characters` });
      else if (seen.has(attributeKey(a.label))) ctx.addIssue({ code: "custom", path: [i, "label"], message: "Already used above" });
      if (!a.value) ctx.addIssue({ code: "custom", path: [i, "value"], message: "Enter a value" });
      else if (a.value.length > ATTRIBUTE_VALUE_MAX) ctx.addIssue({ code: "custom", path: [i, "value"], message: `At most ${ATTRIBUTE_VALUE_MAX} characters` });
      seen.add(attributeKey(a.label));
    });
    if (list.length > MAX_ATTRIBUTES) ctx.addIssue({ code: "custom", path: [], message: `At most ${MAX_ATTRIBUTES} details` });
  });

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
    subcategory: optionalText(SUBCATEGORY_MAX),
    /** Missing: details are left as they are (edit). An empty list clears them. */
    attributes: itemAttributesSchema.optional(),
    unit: z.enum(valuesOf(INVENTORY_UNITS), { error: "Pick a unit" }),
    minStock: optionalMoney,
    vendor: optionalText(200),
    purchaseDate: optionalDateInput,
    description: optionalText(2000),
    location: optionalText(120),
    /** Create only: recorded as the first purchase movement. */
    openingQuantity: money.refine(hasQtyDecimals, "Use at most 3 decimals").optional(),
    openingUnitPrice: optionalMoney,
    /**
     * Create only. True (the default): the opening stock was just bought and is booked as a purchase,
     * with its expense. False: it was already on hand, so no expense now; it is expensed when assigned.
     */
    openingAsPurchase: z.boolean().optional(),
    /** Create only: how an opening purchase was paid (default bank transfer). */
    openingPaymentMethod: purchasePaymentMethod.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.openingQuantity ?? 0) > 0 && v.openingUnitPrice === undefined) {
      ctx.addIssue({ code: "custom", path: ["openingUnitPrice"], message: "Enter the unit price of the opening stock" });
    }
  });

export type ItemFormInput = z.input<typeof itemFormSchema>;
export type ItemFormValues = z.output<typeof itemFormSchema>;

export const itemIdSchema = z.object({ id: objectId });

/**
 * Edit only: the vendor and purchase date the form was filled with. A purchase made while the
 * form is open changes both on the item, so a field still showing its loaded value is left as
 * stored instead of being written back from the older copy. Lenient on purpose: it is a stored
 * value echoed back (a purchase can set a vendor the item form would not accept), not user input.
 */
export const itemLoadedSchema = z.object({
  loaded: z
    .object({
      vendor: z.string().nullish(),
      purchaseDate: z.string().nullish(),
      // Also the details: an import can fill them while the form is open. Missing (a form opened
      // before details existed) leaves both as stored.
      subcategory: z.string().max(500).nullish(),
      attributes: z
        .array(z.object({ label: z.string().max(500), value: z.string().max(5000) }))
        .max(MAX_ATTRIBUTES * 2)
        .optional(),
    })
    .optional(),
});

export const adjustFormSchema = z.object({
  direction: z.enum(["add", "remove"]),
  quantity: stockQuantity,
  reason: requiredText("A reason", 300),
});
export type AdjustFormInput = z.input<typeof adjustFormSchema>;
export type AdjustFormValues = z.output<typeof adjustFormSchema>;

export const adjustStockSchema = z.object({
  id: objectId,
  delta: z
    .number({ error: "Enter a quantity" })
    .finite()
    .refine((n) => n !== 0, "Enter a non-zero quantity")
    .refine(hasQtyDecimals, "Use at most 3 decimals"),
  reason: requiredText("A reason", 300),
});

export const suggestSkuSchema = z.object({ name: z.string().trim().max(160), categoryId: optionalObjectId });

/** Duplicate: the name of the item being copied. */
export const copyNameSchema = z.object({ name: z.string().trim().min(1).max(200) });

/** Add item: what has been typed so far, to look for the same item already in inventory. */
export const similarItemsSchema = z.object({ name: z.string().max(200), sku: z.string().max(80).optional() });

/** Filter keys accepted in the URL of the items list. */
export const ITEM_FILTER_KEYS = ["status", "category", "subcategory", "vendor"] as const;
export const ITEM_SORT_KEYS = ["name", "sku", "available", "allocated", "minStock", "unitPrice", "value", "vendor", "updatedAt"] as const;
export const ITEM_LAYOUTS = ["table", "cards"] as const;
