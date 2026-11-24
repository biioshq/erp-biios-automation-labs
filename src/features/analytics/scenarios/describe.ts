import { BUDGET_HEADS, DEPARTMENTS, PROJECT_STAGES, labelOf, type Department } from "@/lib/constants";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { PRICE_BASES, type ScenarioSpec } from "./schemas";

/**
 * Inputs as readable label and value pairs, for the detail page, the exports and the history
 * ("Change: +10% to +20%"). Client-safe; names of projects, materials and equipment come from the caller.
 */

export type NameLookup = { projects: Map<string, string>; items: Map<string, string>; assets: Map<string, string> };
export type InputLine = { label: string; value: string };

const day = (d: string | undefined) => (d ? formatDate(fromDateInput(d)) : "Not set");
const money = (n: number | undefined) => (n === undefined ? "Not set" : formatCurrency(n));
const num = (n: number | undefined, unit = "") => (n === undefined ? "Not set" : `${formatNumber(n)}${unit}`);
const pct = (n: number | undefined) => (n === undefined ? "Not set" : `${n >= 0 ? "+" : ""}${formatNumber(n)}%`);
const basis = (b: string) => PRICE_BASES.find((p) => p.value === b)?.label ?? b;
const names = (ids: string[], map: Map<string, string>) => (ids.length ? ids.map((id) => map.get(id) ?? "Removed record").join(", ") : "None");
const dept = (d: string | undefined) => (d ? labelOf(DEPARTMENTS, d as Department) : "Not set");

export function describeInputs(spec: ScenarioSpec, lookup: NameLookup, options: { admin: boolean }): InputLine[] {
  const i = spec.inputs;
  switch (spec.type) {
    case "demand": {
      const v = spec.inputs;
      return [
        { label: "Projects", value: names(v.projectIds, lookup.projects) },
        { label: "Change", value: v.mode === "percent" ? pct(v.percent) : "Revised quantity per material" },
        ...v.materials.map((m) => ({
          label: lookup.items.get(m.itemId) ?? "Removed material",
          value: `requirement ${formatNumber(m.currentRequirement)}${v.mode === "quantity" ? `, revised ${num(m.revisedQty)}` : ""}`,
        })),
        { label: "Priced at", value: basis(v.priceBasis) },
        { label: "Period", value: v.periodFrom || v.periodTo ? `${day(v.periodFrom)} to ${day(v.periodTo)}` : "Not set" },
      ];
    }
    case "supply_delay": {
      const v = spec.inputs;
      return [
        { label: "Material", value: lookup.items.get(v.itemId) ?? "Removed material" },
        { label: "Vendor", value: v.vendor ?? "Not set" },
        { label: "Original delivery", value: day(v.originalDelivery) },
        { label: "Delay", value: `${v.delay} ${v.delayUnit}` },
        { label: "Units in the delivery", value: num(v.orderQty) },
        { label: "Projects", value: names(v.projectIds, lookup.projects) },
        { label: "Priced at", value: basis(v.priceBasis) },
      ];
    }
    case "new_project": {
      const v = spec.inputs;
      return [
        { label: "Project name", value: v.projectName },
        { label: "Dates", value: `${day(v.startDate)} to ${day(v.endDate)}` },
        { label: "Scope", value: v.scope ?? "Not set" },
        { label: "Size", value: v.size ?? "Not set" },
        { label: "Materials", value: v.materials.length ? v.materials.map((m) => `${lookup.items.get(m.itemId) ?? "Removed material"} × ${formatNumber(m.qty)}`).join(", ") : "None" },
        { label: "Equipment", value: v.equipment.length ? v.equipment.map((e) => `${(e.assetId && lookup.assets.get(e.assetId)) || e.name || "Equipment"} × ${e.qty}`).join(", ") : "None" },
        { label: "Manpower", value: v.manpower.length ? v.manpower.map((m) => `${m.count} ${dept(m.department)}${m.role ? ` (${m.role})` : ""} for ${formatNumber(m.months)} months`).join(", ") : "None" },
        { label: "Labour cost", value: money(v.labourCost) },
        { label: "Material cost", value: money(v.materialCost) },
        { label: "Equipment cost", value: money(v.equipmentCost) },
        { label: "Other costs", value: money(v.otherCost) },
        { label: "Proposed budget", value: money(v.proposedBudget) },
        { label: "Priced at", value: basis(v.priceBasis) },
      ];
    }
    case "price": {
      const v = spec.inputs;
      return [
        { label: "Material", value: lookup.items.get(v.itemId) ?? "Removed material" },
        { label: "Current price basis", value: basis(v.currentBasis) },
        { label: "Change", value: v.mode === "price" ? `revised price ${money(v.revisedPrice)}` : pct(v.percent) },
        { label: "Expected quantity", value: num(v.expectedQty) },
        { label: "Projects", value: names(v.projectIds, lookup.projects) },
      ];
    }
    case "budget": {
      const v = spec.inputs;
      return [
        { label: "Scope", value: v.scope === "project" ? `Project: ${lookup.projects.get(v.projectId ?? "") ?? "Removed project"}` : v.scope === "department" ? `Department: ${dept(v.department)}` : "Overall business" },
        ...(v.scope === "project" ? [{ label: "Stage", value: v.stage ? labelOf(PROJECT_STAGES, v.stage) : "Whole project" }] : []),
        { label: "Budget head", value: v.head ? labelOf(BUDGET_HEADS, v.head) : "All heads" },
        { label: "Current budget", value: money(v.currentBudget) },
        { label: "Proposed", value: v.mode === "amount" ? money(v.proposedBudget) : `${(v.change ?? 0) >= 0 ? "+" : "-"}${formatCurrency(Math.abs(v.change ?? 0))}` },
        { label: "Period", value: `${day(v.periodFrom)} to ${day(v.periodTo)}` },
      ];
    }
    case "manpower": {
      const v = spec.inputs;
      return [
        { label: "Scope", value: v.scope === "project" ? `Project: ${lookup.projects.get(v.projectId ?? "") ?? "Removed project"}` : `Department: ${dept(v.department)}` },
        { label: "Role", value: v.role ?? "Not set" },
        { label: "Skill", value: v.skill ?? "Not set" },
        { label: "Required people", value: num(v.requiredCount) },
        { label: "Period", value: `${day(v.periodFrom)} to ${day(v.periodTo)}` },
        ...(options.admin ? [{ label: "Monthly cost a person", value: v.monthlyCost === undefined ? "Department average" : money(v.monthlyCost) }] : []),
        { label: "Overtime", value: v.overtimeHours ? `${formatNumber(v.overtimeHours)} hours a month at ${money(v.overtimeRate)}` : "None" },
      ];
    }
    case "equipment": {
      const v = spec.inputs;
      return [
        { label: "Equipment", value: v.assetIds.length ? names(v.assetIds, lookup.assets) : (v.equipmentName ?? "Not set") },
        { label: "Project", value: lookup.projects.get(v.projectId) ?? "Removed project" },
        { label: "Required units", value: num(v.requiredQty) },
        { label: "Usage period", value: `${day(v.usageFrom)} to ${day(v.usageTo)}` },
        { label: "Expected return", value: day(v.expectedReturn) },
        { label: "Acquisition", value: v.acquisition === "rent" ? "Rent" : "Purchase" },
        { label: v.acquisition === "rent" ? "Rent per unit per day" : "Cost per unit", value: money(v.unitCost) },
      ];
    }
    default:
      return Object.keys(i).map((k) => ({ label: k, value: String((i as Record<string, unknown>)[k]) }));
  }
}

/** "Change: +10% to +20%" for every line that differs; added and removed lines say so. */
export function diffInputs(before: InputLine[], after: InputLine[]): string[] {
  const out: string[] = [];
  const old = new Map(before.map((l) => [l.label, l.value]));
  const now = new Map(after.map((l) => [l.label, l.value]));
  for (const [label, value] of now) {
    if (!old.has(label)) out.push(`${label}: added (${value})`);
    else if (old.get(label) !== value) out.push(`${label}: ${old.get(label)} to ${value}`);
  }
  for (const [label] of old) if (!now.has(label)) out.push(`${label}: removed`);
  return out;
}
