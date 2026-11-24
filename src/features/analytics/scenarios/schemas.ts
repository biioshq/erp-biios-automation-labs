import { z } from "zod";
import { BUDGET_HEADS, DEPARTMENTS, PROJECT_STAGES, SCENARIO_STATUSES, SCENARIO_TYPES, valuesOf, type ScenarioType } from "@/lib/constants";
import { dateInput, MAX_MONEY, objectId, optionalDateInput, optionalObjectId, optionalText, requiredText } from "@/lib/zod";

/**
 * Validation shared by the scenario forms (client) and the scenario actions (server). Client-safe.
 * Inputs are hypothetical and are stored only on the scenario: nothing here writes stock, budgets,
 * purchases, people or money records. Dates are "yyyy-mm-dd" IST calendar days.
 */

const MAX_QTY = 1e9;
const qty = (label = "Quantity") =>
  z.number({ error: `Enter a ${label.toLowerCase()}` }).finite().min(0, "Cannot be negative").max(MAX_QTY, "That quantity is too large");
const positiveQty = (label = "Quantity") =>
  z.number({ error: `Enter a ${label.toLowerCase()}` }).finite().positive("Must be more than zero").max(MAX_QTY, "That quantity is too large");
const money = z.number({ error: "Enter an amount" }).finite().min(0, "Cannot be negative").max(MAX_MONEY, "That amount is too large");
const optionalMoney = money.optional();
const percent = z.number({ error: "Enter a percentage" }).finite().min(-100, "At least -100%").max(1000, "At most 1000%");
const ids = (max: number) => z.array(objectId).max(max, `At most ${max}`);

export const PRICE_BASES = [
  { value: "last_purchase", label: "Last purchase price" },
  { value: "average", label: "Average cost of stock" },
] as const;
const priceBasis = z.enum(["last_purchase", "average"], { error: "Pick a price basis" });

function periodCheck(from: string | undefined, to: string | undefined, ctx: z.RefinementCtx, path: string[] = ["periodTo"]) {
  if (from && to && to < from) ctx.addIssue({ code: "custom", path, message: "Ends before it starts" });
}

/* 1.1 Demand change */

export const demandMaterialSchema = z.object({
  itemId: objectId,
  /** What the chosen projects need of this material today (prefilled from what they used so far). */
  currentRequirement: qty("Requirement"),
  /** Quantity mode only: the revised requirement. */
  revisedQty: qty("Revised quantity").optional(),
});

export const demandInputsSchema = z
  .object({
    projectIds: ids(30).min(1, "Pick at least one project"),
    materials: z.array(demandMaterialSchema).min(1, "Add at least one material").max(40, "At most 40 materials"),
    mode: z.enum(["percent", "quantity"]),
    percent: percent.optional(),
    priceBasis,
    periodFrom: optionalDateInput,
    periodTo: optionalDateInput,
  })
  .superRefine((v, ctx) => {
    if (v.mode === "percent" && v.percent === undefined) ctx.addIssue({ code: "custom", path: ["percent"], message: "Enter the expected change" });
    if (v.mode === "quantity") {
      v.materials.forEach((m, i) => {
        if (m.revisedQty === undefined) ctx.addIssue({ code: "custom", path: ["materials", i, "revisedQty"], message: "Enter the revised quantity" });
      });
    }
    const seen = new Set<string>();
    v.materials.forEach((m, i) => {
      if (seen.has(m.itemId)) ctx.addIssue({ code: "custom", path: ["materials", i, "itemId"], message: "Already listed" });
      seen.add(m.itemId);
    });
    periodCheck(v.periodFrom, v.periodTo, ctx);
  });

/* 1.2 Supply delay */

export const supplyDelayInputsSchema = z
  .object({
    vendor: optionalText(200),
    itemId: objectId,
    originalDelivery: dateInput,
    delay: z.number({ error: "Enter the delay" }).int("Whole days or weeks").positive("Must be more than zero").max(520, "At most 520"),
    delayUnit: z.enum(["days", "weeks"]),
    /** Units expected in the delayed delivery; optional, used to show what arrives late. */
    orderQty: qty("Order quantity").optional(),
    projectIds: ids(30),
    priceBasis,
  });

/* 1.3 New project */

export const newProjectMaterialSchema = z.object({ itemId: objectId, qty: positiveQty() });
export const newProjectEquipmentSchema = z
  .object({
    assetId: optionalObjectId,
    name: optionalText(160),
    qty: z.number({ error: "Enter a quantity" }).int("Whole units").positive("Must be more than zero").max(10000),
  })
  .superRefine((v, ctx) => {
    if (!v.assetId && !v.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Pick equipment or type its name" });
  });
export const newProjectManpowerSchema = z.object({
  department: z.enum(valuesOf(DEPARTMENTS), { error: "Pick a department" }),
  role: optionalText(80),
  count: z.number({ error: "Enter a count" }).int("Whole people").positive("Must be more than zero").max(10000),
  months: z.number({ error: "Enter months" }).finite().positive("Must be more than zero").max(120, "At most 120 months"),
});

export const newProjectInputsSchema = z
  .object({
    projectName: requiredText("Project name", 160),
    startDate: dateInput,
    endDate: dateInput,
    scope: optionalText(2000),
    size: optionalText(200),
    materials: z.array(newProjectMaterialSchema).max(60, "At most 60 materials"),
    equipment: z.array(newProjectEquipmentSchema).max(30, "At most 30 lines"),
    manpower: z.array(newProjectManpowerSchema).max(30, "At most 30 lines"),
    labourCost: optionalMoney,
    materialCost: optionalMoney,
    equipmentCost: optionalMoney,
    otherCost: optionalMoney,
    proposedBudget: optionalMoney,
    priceBasis,
  })
  .superRefine((v, ctx) => {
    periodCheck(v.startDate, v.endDate, ctx, ["endDate"]);
    const seen = new Set<string>();
    v.materials.forEach((m, i) => {
      if (seen.has(m.itemId)) ctx.addIssue({ code: "custom", path: ["materials", i, "itemId"], message: "Already listed" });
      seen.add(m.itemId);
    });
  });

/* 1.4 Purchase price change */

export const priceInputsSchema = z
  .object({
    itemId: objectId,
    currentBasis: priceBasis,
    mode: z.enum(["price", "percent"]),
    revisedPrice: optionalMoney,
    percent: percent.optional(),
    expectedQty: positiveQty("Expected quantity"),
    projectIds: ids(30),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "price" && v.revisedPrice === undefined) ctx.addIssue({ code: "custom", path: ["revisedPrice"], message: "Enter the revised price" });
    if (v.mode === "percent" && v.percent === undefined) ctx.addIssue({ code: "custom", path: ["percent"], message: "Enter the expected change" });
  });

/* 1.5 Budget planning */

export const budgetInputsSchema = z
  .object({
    scope: z.enum(["project", "department", "overall"]),
    projectId: optionalObjectId,
    department: z.enum(valuesOf(DEPARTMENTS)).optional(),
    /** A project stage: the stage budget is the allocation. Empty = the whole project budget. */
    stage: z.enum(valuesOf(PROJECT_STAGES)).optional(),
    /** Empty = every budget head. */
    head: z.enum(valuesOf(BUDGET_HEADS)).optional(),
    currentBudget: money,
    mode: z.enum(["amount", "change"]),
    proposedBudget: optionalMoney,
    /** Signed change to the allocation. */
    change: z.number({ error: "Enter the change" }).finite().min(-MAX_MONEY).max(MAX_MONEY).optional(),
    periodFrom: dateInput,
    periodTo: dateInput,
  })
  .superRefine((v, ctx) => {
    if (v.scope === "project" && !v.projectId) ctx.addIssue({ code: "custom", path: ["projectId"], message: "Pick a project" });
    if (v.scope === "department" && !v.department) ctx.addIssue({ code: "custom", path: ["department"], message: "Pick a department" });
    if (v.mode === "amount" && v.proposedBudget === undefined) ctx.addIssue({ code: "custom", path: ["proposedBudget"], message: "Enter the proposed budget" });
    if (v.mode === "change" && v.change === undefined) ctx.addIssue({ code: "custom", path: ["change"], message: "Enter the change" });
    if (v.mode === "change" && v.change !== undefined && v.currentBudget + v.change < 0) {
      ctx.addIssue({ code: "custom", path: ["change"], message: "Would take the budget below zero" });
    }
    periodCheck(v.periodFrom, v.periodTo, ctx);
  });

/* 1.6 HR and manpower */

export const manpowerInputsSchema = z
  .object({
    scope: z.enum(["project", "department"]),
    projectId: optionalObjectId,
    department: z.enum(valuesOf(DEPARTMENTS)).optional(),
    role: optionalText(80),
    skill: optionalText(40),
    requiredCount: z.number({ error: "Enter the number needed" }).int("Whole people").min(0, "Cannot be negative").max(10000),
    periodFrom: dateInput,
    periodTo: dateInput,
    /** Monthly cost per person. Only people who see salaries see or send it. */
    monthlyCost: optionalMoney,
    overtimeHours: z.number().finite().min(0).max(400, "At most 400 hours a month").optional(),
    overtimeRate: optionalMoney,
  })
  .superRefine((v, ctx) => {
    if (v.scope === "project" && !v.projectId) ctx.addIssue({ code: "custom", path: ["projectId"], message: "Pick a project" });
    if (v.scope === "department" && !v.department) ctx.addIssue({ code: "custom", path: ["department"], message: "Pick a department" });
    periodCheck(v.periodFrom, v.periodTo, ctx);
  });

/** Salary input fields. An edit by someone who does not see salaries keeps whatever was entered there. */
export const ADMIN_ONLY_INPUTS: Partial<Record<ScenarioType, string[]>> = {
  manpower: ["monthlyCost"],
};

/* 1.7 Equipment */

export const equipmentInputsSchema = z
  .object({
    assetIds: ids(40),
    equipmentName: optionalText(160),
    projectId: objectId,
    requiredQty: z.number({ error: "Enter the quantity needed" }).int("Whole units").positive("Must be more than zero").max(10000),
    usageFrom: dateInput,
    usageTo: dateInput,
    acquisition: z.enum(["rent", "purchase"]),
    /** Rent: per unit per day. Purchase: per unit. */
    unitCost: optionalMoney,
    expectedReturn: optionalDateInput,
  })
  .superRefine((v, ctx) => {
    if (!v.assetIds.length && !v.equipmentName) ctx.addIssue({ code: "custom", path: ["equipmentName"], message: "Pick equipment from the register or type its name" });
    periodCheck(v.usageFrom, v.usageTo, ctx, ["usageTo"]);
    if (v.expectedReturn && v.expectedReturn < v.usageFrom) ctx.addIssue({ code: "custom", path: ["expectedReturn"], message: "Before the usage starts" });
  });

/* The whole form */

export const scenarioTypeSchema = z.enum(valuesOf(SCENARIO_TYPES));
export const scenarioStatusSchema = z.enum(valuesOf(SCENARIO_STATUSES));

const meta = {
  name: requiredText("Name", 160),
  description: optionalText(4000),
  assumptions: optionalText(4000),
};

export const demandFormSchema = z.object({ ...meta, type: z.literal("demand"), inputs: demandInputsSchema });
export const supplyDelayFormSchema = z.object({ ...meta, type: z.literal("supply_delay"), inputs: supplyDelayInputsSchema });
export const newProjectFormSchema = z.object({ ...meta, type: z.literal("new_project"), inputs: newProjectInputsSchema });
export const priceFormSchema = z.object({ ...meta, type: z.literal("price"), inputs: priceInputsSchema });
export const budgetFormSchema = z.object({ ...meta, type: z.literal("budget"), inputs: budgetInputsSchema });
export const manpowerFormSchema = z.object({ ...meta, type: z.literal("manpower"), inputs: manpowerInputsSchema });
export const equipmentFormSchema = z.object({ ...meta, type: z.literal("equipment"), inputs: equipmentInputsSchema });

export const scenarioFormSchema = z.discriminatedUnion("type", [
  demandFormSchema,
  supplyDelayFormSchema,
  newProjectFormSchema,
  priceFormSchema,
  budgetFormSchema,
  manpowerFormSchema,
  equipmentFormSchema,
]);

export type ScenarioFormValues = z.output<typeof scenarioFormSchema>;
export type DemandInputs = z.output<typeof demandInputsSchema>;
export type SupplyDelayInputs = z.output<typeof supplyDelayInputsSchema>;
export type NewProjectInputs = z.output<typeof newProjectInputsSchema>;
export type PriceInputs = z.output<typeof priceInputsSchema>;
export type BudgetInputs = z.output<typeof budgetInputsSchema>;
export type ManpowerInputs = z.output<typeof manpowerInputsSchema>;
export type EquipmentInputs = z.output<typeof equipmentInputsSchema>;

/** A scenario's type and its validated inputs, as compute functions take them. */
export type ScenarioSpec =
  | { type: "demand"; inputs: DemandInputs }
  | { type: "supply_delay"; inputs: SupplyDelayInputs }
  | { type: "new_project"; inputs: NewProjectInputs }
  | { type: "price"; inputs: PriceInputs }
  | { type: "budget"; inputs: BudgetInputs }
  | { type: "manpower"; inputs: ManpowerInputs }
  | { type: "equipment"; inputs: EquipmentInputs };

export const INPUT_SCHEMAS = {
  demand: demandInputsSchema,
  supply_delay: supplyDelayInputsSchema,
  new_project: newProjectInputsSchema,
  price: priceInputsSchema,
  budget: budgetInputsSchema,
  manpower: manpowerInputsSchema,
  equipment: equipmentInputsSchema,
} as const;

/** Parses stored inputs of a type; null when they no longer validate (the form then starts from them anyway). */
export function parseSpec(type: string, inputs: unknown): ScenarioSpec | null {
  const parsedType = scenarioTypeSchema.safeParse(type);
  if (!parsedType.success) return null;
  const parsed = INPUT_SCHEMAS[parsedType.data].safeParse(inputs);
  return parsed.success ? ({ type: parsedType.data, inputs: parsed.data } as ScenarioSpec) : null;
}

/* Actions */

export const createScenarioSchema = z.object({
  form: scenarioFormSchema,
  /** "draft" keeps it as work in progress; "saved" marks it ready to share. */
  status: z.enum(["draft", "saved"]),
});
/** `updatedAt` is when the edit form was loaded: saving over someone else's later change is refused. */
export const updateScenarioSchema = z.object({ id: objectId, form: scenarioFormSchema, updatedAt: z.string().max(40).optional() });
export const scenarioIdSchema = z.object({ id: objectId });
export const scenarioStatusChangeSchema = z.object({
  id: objectId,
  status: scenarioStatusSchema,
  note: optionalText(1000),
});
export const previewScenarioSchema = scenarioFormSchema;
export const demandPrefillSchema = z.object({ projectIds: ids(30), itemIds: ids(40) });

/* Lists */

export const SCENARIO_FILTER_KEYS = ["type", "status", "creator"] as const;
export const SCENARIO_SORT_KEYS = ["name", "code", "createdAt", "updatedAt"] as const;
export const HISTORY_FILTER_KEYS = ["type", "action", "status", "user", "scenario"] as const;

export const HISTORY_ACTIONS = [
  { value: "created", label: "Created" },
  { value: "edited", label: "Edited" },
  { value: "status", label: "Status changed" },
  { value: "duplicated", label: "Duplicated" },
  { value: "recalculated", label: "Results updated" },
] as const;
