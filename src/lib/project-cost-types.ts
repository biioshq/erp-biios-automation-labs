/**
 * How the spend of a project splits by type of cost, by expense category. One mapping for the
 * project finance pages and the analytics pages, so a type has the same label and the same
 * categories everywhere. Client-safe and pure.
 */

/** How the spend of a project splits for the client's report: by expense category. */
export const SPEND_TYPES = [
  { key: "material", label: "Materials", categories: ["materials", "inventory"] },
  { key: "labour", label: "Labour", categories: ["labour", "contractors", "salaries"] },
  { key: "equipment", label: "Equipment", categories: ["equipment"] },
  { key: "transport", label: "Transportation", categories: ["logistics", "travel"] },
  { key: "other", label: "Other", categories: [] },
] as const;

export type SpendType = (typeof SPEND_TYPES)[number]["key"];
export type SpendByType = Record<SpendType, number>;

const TYPE_OF = new Map<string, SpendType>(SPEND_TYPES.flatMap((t) => t.categories.map((c) => [c, t.key] as [string, SpendType])));

/** The spend type of a stored category value. Custom categories and the rest count as other. */
export function spendTypeOf(category: string | null | undefined): SpendType {
  return (category && TYPE_OF.get(category)) || "other";
}

export const emptySpendByType = (): SpendByType => ({ material: 0, labour: 0, equipment: 0, transport: 0, other: 0 });

/** The first recorded budget: the oldest history entry, or the budget itself when it never changed. */
export function originalBudgetOf(budget: number, history: { budget: number }[] | null | undefined): number {
  return history?.length ? history[0].budget : budget;
}
