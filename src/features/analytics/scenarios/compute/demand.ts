import { formatCurrency, formatNumber } from "@/lib/format";
import type { DemandInputs } from "../schemas";
import type { ResultTable, ScenarioResults } from "../types";
import type { AllocationFact, ComputeContext, ItemFact, ProjectFact } from "./facts";
import {
  PRICE_BASIS_LABEL,
  SALARIES_NOTE,
  budgetImpactTable,
  compareRow,
  emptyMetrics,
  periodDays,
  priceOf,
  qtyByUnit,
  round2,
  round3,
  splitAmount,
  splitIsWeighted,
  stat,
  sumOf,
  wholeUp,
  viewOf,
} from "./common";

export type DemandFacts = {
  items: Map<string, ItemFact>;
  /** Open allocations of the listed materials, on every project. */
  allocations: AllocationFact[];
  /** The chosen projects. */
  projects: ProjectFact[];
};

export type DemandLine = {
  item: ItemFact;
  original: number;
  revised: number;
  change: number;
  /** Units the chosen projects already hold (wasted ones included: they were used). */
  issuedHere: number;
  /** Of those, units still in use (wasted ones left out): they are part of the physical stock. */
  inUseHere: number;
  /** Units in use on other projects (wasted ones excluded). */
  issuedOther: number;
  available: number;
  stillToIssueNow: number;
  stillToIssue: number;
  buyNow: number;
  buy: number;
  price: number;
  priceBasis: "last_purchase" | "average";
  fellBack: boolean;
  costOfChange: number;
  procurementNow: number;
  procurement: number;
};

/** One material line: the requirement before and after, the stock that covers it and what must be bought. */
export function demandLine(
  item: ItemFact,
  input: DemandInputs["materials"][number],
  inputs: Pick<DemandInputs, "mode" | "percent" | "priceBasis" | "projectIds">,
  allocations: AllocationFact[],
): DemandLine {
  const chosen = new Set(inputs.projectIds);
  const original = round3(input.currentRequirement);
  const revised = inputs.mode === "percent" ? Math.max(0, wholeUp(original * (1 + (inputs.percent ?? 0) / 100), item.unit)) : round3(input.revisedQty ?? original);
  const mine = allocations.filter((a) => a.itemId === item.id);
  const issuedHere = round3(mine.filter((a) => chosen.has(a.projectId)).reduce((s, a) => s + a.quantity, 0));
  const inUseHere = round3(mine.filter((a) => chosen.has(a.projectId)).reduce((s, a) => s + a.inUse, 0));
  const issuedOther = round3(mine.filter((a) => !chosen.has(a.projectId)).reduce((s, a) => s + a.inUse, 0));
  const available = round3(item.available);
  const stillToIssueNow = round3(Math.max(0, original - issuedHere));
  const stillToIssue = round3(Math.max(0, revised - issuedHere));
  const buyNow = round3(Math.max(0, stillToIssueNow - available));
  const buy = round3(Math.max(0, stillToIssue - available));
  const p = priceOf(item, inputs.priceBasis);
  return {
    item,
    original,
    revised,
    change: round3(revised - original),
    issuedHere,
    inUseHere,
    issuedOther,
    available,
    stillToIssueNow,
    stillToIssue,
    buyNow,
    buy,
    price: p.price,
    priceBasis: p.basis,
    fellBack: p.fellBack,
    costOfChange: round2((revised - original) * p.price),
    procurementNow: round2(buyNow * p.price),
    procurement: round2(buy * p.price),
  };
}

function requirementTable(lines: DemandLine[]): ResultTable {
  return {
    key: "requirement",
    title: "Requirement and stock",
    description:
      "Still to issue is the revised requirement less what the chosen projects already hold. Stock is not reserved in the ERP, so units issued to other projects are shown instead. Physical stock is storage plus units in use on projects; wasted units are left out.",
    columns: [
      { key: "material", header: "Material", type: "text" },
      { key: "original", header: "Original requirement", type: "number" },
      { key: "revised", header: "Revised requirement", type: "number" },
      { key: "change", header: "Change", type: "number" },
      { key: "issuedHere", header: "Already with these projects", type: "number" },
      { key: "issuedOther", header: "Issued to other projects", type: "number" },
      { key: "available", header: "Available in storage", type: "number" },
      { key: "physical", header: "Physical stock", type: "number" },
      { key: "stillToIssue", header: "Still to issue", type: "number" },
      { key: "buy", header: "To buy", type: "number" },
    ],
    rows: lines.map((l) => ({
      cells: {
        material: `${l.item.name} (${l.item.unit})`,
        original: l.original,
        revised: l.revised,
        change: l.change,
        issuedHere: l.issuedHere,
        issuedOther: l.issuedOther,
        available: l.available,
        physical: round3(l.available + l.inUseHere + l.issuedOther),
        stillToIssue: l.stillToIssue,
        buy: l.buy,
      },
      links: { material: `/inventory/items/${l.item.id}` },
      tone: l.buy > 0 ? "danger" : undefined,
    })),
  };
}

function costTable(lines: DemandLine[]): ResultTable {
  return {
    key: "cost",
    title: "Purchase and cost",
    description: "To buy now is what the original requirement already needed beyond storage. The additional procurement cost is the scenario's purchases less those.",
    columns: [
      { key: "material", header: "Material", type: "text" },
      { key: "basis", header: "Priced at", type: "text" },
      { key: "price", header: "Unit price", type: "money" },
      { key: "buyNow", header: "To buy now", type: "number" },
      { key: "buy", header: "To buy in scenario", type: "number" },
      { key: "extraBuy", header: "Additional purchase", type: "number" },
      { key: "procurement", header: "Additional procurement cost", type: "money" },
      { key: "costOfChange", header: "Change in material cost", type: "money" },
    ],
    rows: lines.map((l) => ({
      cells: {
        material: l.item.name,
        basis: `${PRICE_BASIS_LABEL[l.priceBasis]}${l.fellBack ? " (no purchase price recorded)" : ""}`,
        price: l.price,
        buyNow: l.buyNow,
        buy: l.buy,
        extraBuy: round3(l.buy - l.buyNow),
        procurement: round2(l.procurement - l.procurementNow),
        costOfChange: l.costOfChange,
      },
      links: { material: `/inventory/items/${l.item.id}` },
    })),
    totals: { material: "Total", procurement: sumOf(lines, (l) => l.procurement - l.procurementNow), costOfChange: sumOf(lines, (l) => l.costOfChange) },
  };
}

/** 1.1 Demand change: more or less of some materials on some projects. */
export function computeDemand(inputs: DemandInputs, facts: DemandFacts, ctx: ComputeContext): ScenarioResults {
  const lines = inputs.materials.flatMap((m) => {
    const item = facts.items.get(m.itemId);
    return item ? [demandLine(item, m, inputs, facts.allocations)] : [];
  });
  const missing = inputs.materials.length - lines.length;

  // Each material's cost change goes to the chosen projects in proportion to what they used of it.
  const extra = new Map<string, number>();
  let weighted = false;
  for (const l of lines) {
    const weights = new Map<string, number>();
    for (const a of facts.allocations) if (a.itemId === l.item.id) weights.set(a.projectId, (weights.get(a.projectId) ?? 0) + a.quantity);
    weighted ||= splitIsWeighted(inputs.projectIds, weights);
    for (const [id, part] of splitAmount(l.costOfChange, inputs.projectIds, weights)) extra.set(id, round2((extra.get(id) ?? 0) + part));
  }
  const budget = budgetImpactTable(facts.projects, extra);

  const procurementNow = sumOf(lines, (l) => l.procurementNow);
  const procurement = sumOf(lines, (l) => l.procurement);
  const additionalProcurement = round2(procurement - procurementNow);
  const costOfChange = sumOf(lines, (l) => l.costOfChange);
  const short = lines.filter((l) => l.buy > 0);
  const shortNow = lines.filter((l) => l.buyNow > 0);
  const spent = sumOf(facts.projects, (p) => p.spent);
  const budgetTotal = sumOf(facts.projects, (p) => p.budget);
  const changeLabel = inputs.mode === "percent" ? `${(inputs.percent ?? 0) >= 0 ? "+" : ""}${inputs.percent ?? 0}%` : "revised quantities";
  const unitsAdded = qtyByUnit(lines.map((l) => ({ unit: l.item.unit, qty: l.change })));

  const metrics = emptyMetrics();
  metrics.materials = unitsAdded;
  metrics.procurementCost = additionalProcurement;
  metrics.projectCost = costOfChange;
  metrics.overBudget = budget.overBudget;
  metrics.shortItems = short.length;
  for (const l of short) metrics.risks.push(`${l.item.name}: ${formatNumber(l.buy)} ${l.item.unit} short unless bought`);
  for (const r of budget.table.rows) if (r.tone === "danger") metrics.risks.push(`${r.cells.project} goes over budget`);

  const comparison = [
    ...lines.flatMap((l) => [
      compareRow(`req-${l.item.id}`, `${l.item.name}: requirement`, "number", l.original, l.revised, l.item.unit),
      compareRow(`buy-${l.item.id}`, `${l.item.name}: to buy`, "number", l.buyNow, l.buy, l.item.unit),
    ]),
    compareRow("procurement", "Purchase cost to meet the requirement", "money", procurementNow, procurement),
    compareRow("spent", "Spend of the chosen projects", "money", spent, round2(spent + costOfChange)),
    compareRow("used", "Budget used by the chosen projects", "percent", budgetTotal > 0 ? spent / budgetTotal : null, budgetTotal > 0 ? (spent + costOfChange) / budgetTotal : null),
    compareRow("short", "Materials short", "number", shortNow.length, short.length),
  ];

  const single = lines.length === 1 ? lines[0] : null;
  const headline = single
    ? `With ${changeLabel}, ${single.item.name} goes from ${formatNumber(single.original)} to ${formatNumber(single.revised)} ${single.item.unit}. ${
        single.buy > 0
          ? `Storage cannot cover it: ${formatNumber(single.buy)} ${single.item.unit} must be bought (${formatCurrency(single.procurement)}${
              single.procurementNow > 0 ? `, of which ${formatCurrency(round2(single.procurement - single.procurementNow))} comes from the change` : ""
            }).`
          : "Stock in storage covers it."
      }`
    : `With ${changeLabel}, ${lines.length} materials change by ${unitsAdded.map((u) => `${formatNumber(u.qty)} ${u.unit}`).join(", ") || "nothing"}. ${
        short.length ? `${short.length} would run short; the additional purchases cost ${formatCurrency(additionalProcurement)}.` : "Stock in storage covers every one."
      }`;

  const notes = [
    `Materials are priced at the ${PRICE_BASIS_LABEL[inputs.priceBasis].toLowerCase()}${lines.some((l) => l.fellBack) ? "; materials with no purchase price recorded use their average cost" : ""}.`,
    weighted
      ? "The extra cost is split across the chosen projects in proportion to what each already used of the material."
      : "None of the chosen projects has used these materials yet, so the extra cost is split equally between them.",
  ];
  if (!ctx.salaries) notes.push(SALARIES_NOTE);
  if (missing > 0) notes.push(`${missing} material${missing === 1 ? " is" : "s are"} no longer in inventory and left out.`);

  const stats = [
    single
      ? stat("revised", "Revised requirement", "number", single.revised, { unit: single.item.unit, hint: `was ${formatNumber(single.original)}` })
      : stat("materials", "Materials in the scenario", "number", lines.length),
    stat("change", single ? "Additional quantity" : "Change in material cost", single ? "number" : "money", single ? single.change : costOfChange, single ? { unit: single.item.unit } : {}),
    stat("buy", "Additional procurement cost", "money", additionalProcurement, { tone: additionalProcurement > 0 ? "warning" : "default", hint: short.length ? `${short.length} short` : "no shortage" }),
    stat("over", "Over budget after scenario", "money", budget.overBudget, { tone: budget.overBudget > 0 ? "danger" : "success" }),
  ];

  if (inputs.periodFrom && inputs.periodTo) {
    const days = periodDays(inputs.periodFrom, inputs.periodTo);
    for (const l of lines) {
      if (days <= 0) continue;
      comparison.push(compareRow(`rate-${l.item.id}`, `${l.item.name}: units a day`, "number", l.item.perDay === null ? null : round3(l.item.perDay), round3(l.stillToIssue / days), l.item.unit));
    }
    notes.push(`Units a day compares recent use (last ${lines[0]?.item.windowDays ?? 90} days, all projects) with what is still to issue spread over the ${days}-day period.`);
  }

  return {
    version: 1,
    type: "demand",
    computedAt: new Date().toISOString(),
    view: viewOf(ctx),
    headline,
    stats,
    comparison,
    tables: [requirementTable(lines), costTable(lines), budget.table],
    chart:
      lines.length > 0 && lines.length <= 12
        ? {
            title: "Requirement per material",
            type: "number",
            currentLabel: "Original",
            scenarioLabel: "Scenario",
            points: lines.map((l) => ({ label: l.item.name, current: l.original, scenario: l.revised })),
          }
        : null,
    metrics,
    notes,
    notRecorded: [
      { label: "Reserved stock", detail: "The ERP does not record reservations. Stock already issued to other projects is shown instead." },
      {
        label: "Pending purchase orders and expected incoming stock",
        detail: "Purchase orders and expected deliveries are not recorded, so no incoming stock is counted. Shortages assume nothing else arrives.",
      },
    ],
  };
}
