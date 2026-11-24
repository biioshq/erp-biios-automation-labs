"use client";

import type { Option } from "@/components/forms/fields";
import { formatCurrency } from "@/lib/format";
import { toDateInput, financialYearIST, addDays } from "@/lib/dates";
import { PRICE_BASES } from "../../schemas";
import type { ItemChoice, ProjectChoice, ScenarioFormOptions } from "../../types";

/** Option lists and defaults shared by the scenario forms. */

export type InitialScenario = {
  id: string;
  name: string;
  description: string | null;
  assumptions: string | null;
  inputs: Record<string, unknown>;
  /** ISO time the scenario was last saved, so a stale edit form cannot overwrite a later change. */
  updatedAt?: string;
};
export type TypeFormProps = { options: ScenarioFormOptions; initial?: InitialScenario; isAdmin: boolean };

export function projectOptions(projects: ProjectChoice[]): Option[] {
  return projects.map((p) => ({
    value: p.value,
    label: p.label,
    description: p.description,
    icon: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
  }));
}

export function itemOptions(items: ItemChoice[]): Option[] {
  return items.map((i) => ({ value: i.value, label: i.label, description: i.description }));
}

export const priceBasisOptions = PRICE_BASES.map((p) => ({ value: p.value, label: p.label }));

export function itemPriceHint(item: ItemChoice | undefined): string | undefined {
  if (!item) return undefined;
  return `Last purchase ${item.lastPurchasePrice !== null ? formatCurrency(item.lastPurchasePrice) : "not recorded"} · average ${formatCurrency(item.averageCost)} a ${item.unit}`;
}

export const today = () => toDateInput(new Date());
export const inDays = (n: number) => toDateInput(addDays(new Date(), n));
export const fyBounds = () => {
  const fy = financialYearIST();
  return { from: toDateInput(fy.start), to: toDateInput(fy.end) };
};

/** Starting meta fields: the saved ones when editing. */
export function metaDefaults(initial: InitialScenario | undefined, name = "") {
  return { name: initial?.name ?? name, description: initial?.description ?? "", assumptions: initial?.assumptions ?? "" };
}
