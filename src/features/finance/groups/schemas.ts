import { z } from "zod";
import { objectId, optionalText, requiredText } from "@/lib/zod";

/** A subgroup under a built-in group or another subgroup. Client-safe. */
export const subgroupFormSchema = z.object({
  parent: z.string().trim().min(1, "Pick where it goes").max(80),
  name: requiredText("Name", 80),
  description: optionalText(500),
  details: optionalText(2000),
});
export type SubgroupFormInput = z.input<typeof subgroupFormSchema>;
export type SubgroupFormValues = z.output<typeof subgroupFormSchema>;

export const subgroupIdSchema = z.object({ id: objectId });
