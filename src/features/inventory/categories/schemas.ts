import { z } from "zod";
import { objectId, optionalText, requiredText } from "@/lib/zod";

export const categoryFormSchema = z.object({
  name: requiredText("Category name", 80),
  description: optionalText(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
});
export type CategoryFormInput = z.input<typeof categoryFormSchema>;
export type CategoryFormValues = z.output<typeof categoryFormSchema>;

export const categoryIdSchema = z.object({ id: objectId });

/** Swatches offered in the colour picker. Stored with the category, so they are data, not theme colours. */
export const CATEGORY_COLORS = ["#4a82cc", "#12958a", "#f08000", "#7c5cd6", "#d4517a", "#16a36a", "#d99206", "#5b6b82"] as const;
