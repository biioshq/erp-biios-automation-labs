import { ASSET_CONDITIONS, labelOf } from "@/lib/constants";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { EquipmentInputs } from "../schemas";
import type { ScenarioResults } from "../types";
import type { ComputeContext, EquipmentFact, ProjectFact } from "./facts";
import { budgetImpactTable, compareRow, emptyMetrics, periodDays, round2, stat } from "./common";

export type EquipmentFacts = {
  /** The equipment picked, or register equipment matching the typed name. */
  assets: EquipmentFact[];
  project: ProjectFact | null;
};

const UNUSABLE = new Set(["under_maintenance", "damaged", "lost", "disposed"]);
const day = (d: string | null) => (d ? formatDate(fromDateInput(d)) : "no end date");

type AssetState = { asset: EquipmentFact; state: "here" | "free" | "busy" | "unusable"; overlapDays: number | null };

/** Where each asset stands for the usage window. Busy = with another project during it (open-ended counts). */
export function assetStates(assets: EquipmentFact[], projectId: string | null, from: string, to: string): AssetState[] {
  return assets.map((asset) => {
    if (UNUSABLE.has(asset.condition)) return { asset, state: "unusable", overlapDays: null };
    if (asset.projectId && asset.projectId === projectId) return { asset, state: "here", overlapDays: null };
    if (asset.projectId && (!asset.projectUntil || asset.projectUntil >= from)) {
      const end = asset.projectUntil && asset.projectUntil < to ? asset.projectUntil : to;
      return { asset, state: "busy", overlapDays: periodDays(from, end) };
    }
    return { asset, state: "free", overlapDays: null };
  });
}

/** 1.7 Equipment: units a project needs for a period against the register. */
export function computeEquipment(inputs: EquipmentInputs, facts: EquipmentFacts, ctx: ComputeContext): ScenarioResults {
  const states = assetStates(facts.assets, facts.project?.id ?? null, inputs.usageFrom, inputs.usageTo);
  const units = (s: AssetState["state"]) => states.filter((x) => x.state === s).reduce((n, x) => n + x.asset.quantity, 0);
  const here = units("here");
  const free = units("free");
  const busy = units("busy");
  const unusable = units("unusable");
  const required = inputs.requiredQty;
  const additional = Math.max(0, required - here);
  const shortage = Math.max(0, additional - free);
  const days = periodDays(inputs.usageFrom, inputs.expectedReturn ?? inputs.usageTo);
  const cost = inputs.unitCost === undefined ? null : round2(shortage * inputs.unitCost * (inputs.acquisition === "rent" ? days : 1));
  const name = inputs.equipmentName ?? (facts.assets[0]?.name ?? "Equipment");

  const budget = facts.project && cost !== null ? budgetImpactTable([facts.project], new Map([[facts.project.id, cost]]), "Impact on the project budget") : null;

  const metrics = emptyMetrics();
  metrics.equipmentShort = shortage;
  metrics.equipmentCost = cost;
  metrics.projectCost = cost;
  metrics.overBudget = budget?.overBudget ?? null;
  for (const s of states.filter((x) => x.state === "busy")) metrics.risks.push(`${s.asset.name} is with ${s.asset.projectName ?? "another project"} until ${day(s.asset.projectUntil)}`);
  if (shortage > 0) metrics.risks.push(`${shortage} ${name} short for ${facts.project?.name ?? "the project"}`);

  const notes = [
    "Available units are equipment in the fixed asset register that is in usable condition and not with another project during the usage period.",
    inputs.acquisition === "rent"
      ? `Rental cost is per unit per day, for ${days} days${inputs.expectedReturn ? " up to the expected return date" : ""}.`
      : "Purchase cost is per unit.",
  ];
  if (cost === null) notes.push("No cost was entered, so the cost of the shortage is not estimated.");
  if (!facts.assets.length) notes.push(`No equipment in the register matches "${name}", so every unit needed counts as short.`);
  if (!ctx.admin && budget) notes.push("Project spend leaves out salary expenses: only admins see them.");

  const tables: ScenarioResults["tables"] = [
    {
      key: "register",
      title: "Equipment in the register",
      columns: [
        { key: "equipment", header: "Equipment", type: "text" },
        { key: "units", header: "Units", type: "number" },
        { key: "condition", header: "Condition", type: "text" },
        { key: "where", header: "Where it is", type: "text" },
        { key: "state", header: "For this period", type: "text" },
      ],
      rows: states.map((s) => ({
        cells: {
          equipment: `${s.asset.name} (${s.asset.code})`,
          units: s.asset.quantity,
          condition: labelOf(ASSET_CONDITIONS, s.asset.condition),
          where: s.asset.projectId ? `${s.asset.projectName ?? "A project"} until ${day(s.asset.projectUntil)}` : "Not with a project",
          state: s.state === "here" ? "Already with this project" : s.state === "free" ? "Available" : s.state === "busy" ? "Allocated to another project" : "Not usable",
        },
        links: { equipment: `/finance/assets/fixed?view=${s.asset.id}` },
        tone: s.state === "busy" || s.state === "unusable" ? "warning" : undefined,
      })),
      emptyText: "No matching equipment is recorded in the fixed asset register.",
    },
    {
      key: "conflicts",
      title: "Scheduling conflicts",
      columns: [
        { key: "equipment", header: "Equipment", type: "text" },
        { key: "project", header: "With project", type: "text" },
        { key: "until", header: "Until", type: "date" },
        { key: "overlap", header: "Days overlapping", type: "number" },
      ],
      rows: states
        .filter((s) => s.state === "busy")
        .map((s) => ({
          cells: { equipment: s.asset.name, project: s.asset.projectName ?? "Another project", until: s.asset.projectUntil, overlap: s.overlapDays },
          links: s.asset.projectId ? { project: `/finance/projects/${s.asset.projectId}` } : undefined,
          tone: "danger" as const,
        })),
      emptyText: "No conflicts: nothing needed is with another project during the period.",
    },
  ];
  if (budget) tables.push(budget.table);

  const comparison = [
    compareRow("units", "Units with the project", "number", here, required),
    compareRow("free", "Free units in the register", "number", free, Math.max(0, free - additional)),
    compareRow("short", "Units short", "number", 0, shortage),
  ];
  if (facts.project && cost !== null) comparison.push(compareRow("spent", "Project spend", "money", facts.project.spent, round2(facts.project.spent + cost)));

  return {
    version: 1,
    type: "equipment",
    computedAt: new Date().toISOString(),
    view: ctx.admin ? "admin" : "member",
    headline: `${facts.project?.name ?? "The project"} needs ${required} ${name} from ${day(inputs.usageFrom)} to ${day(inputs.usageTo)}. ${
      shortage > 0
        ? `${free} ${free === 1 ? "is" : "are"} free, so ${shortage} must be ${inputs.acquisition === "rent" ? "rented" : "bought"}${cost !== null ? ` (${formatCurrency(cost)})` : ""}.`
        : "The register covers it."
    }`,
    stats: [
      stat("available", "Available units", "number", free + here, { hint: here ? `${here} already with the project` : undefined }),
      stat("busy", "Allocated to other projects", "number", busy, { tone: busy ? "warning" : "default", hint: unusable ? `${unusable} not usable` : undefined }),
      stat("short", "Shortage", "number", shortage, { tone: shortage ? "danger" : "success" }),
      stat("cost", inputs.acquisition === "rent" ? "Estimated rental cost" : "Estimated purchase cost", "money", cost, { hint: cost === null ? "no cost entered" : inputs.acquisition === "rent" ? `${formatNumber(days)} days` : `${formatNumber(shortage)} units` }),
    ],
    comparison,
    tables,
    chart: null,
    metrics,
    notes,
    notRecorded: [
      { label: "Usage hours and bookings", detail: "The register records which project has an asset and until when, not usage hours or future bookings." },
    ],
  };
}
