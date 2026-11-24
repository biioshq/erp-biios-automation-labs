import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { PriceInputs } from "../schemas";
import type { ScenarioResults } from "../types";
import type { AllocationFact, ComputeContext, ItemFact, ProjectFact } from "./facts";
import { PRICE_BASIS_LABEL, SALARIES_NOTE, budgetImpactTable, compareRow, emptyMetrics, priceOf, round2, splitAmount, splitIsWeighted, stat, sumOf } from "./common";

export type PriceFacts = {
  item: ItemFact;
  allocations: AllocationFact[];
  projects: ProjectFact[];
  /** Stock purchases (all materials) booked in the current financial year. */
  procurement: { label: string; total: number; itemQty: number; itemTotal: number };
  /** The material's latest purchases, newest first. */
  purchases: { date: string; qty: number; unitCost: number; vendor: string | null }[];
};

/** 1.4 Purchase price change: one material gets dearer or cheaper. */
export function computePrice(inputs: PriceInputs, facts: PriceFacts, ctx: ComputeContext): ScenarioResults {
  const { item } = facts;
  const current = priceOf(item, inputs.currentBasis);
  const revisedPrice = round2(inputs.mode === "price" ? (inputs.revisedPrice ?? current.price) : Math.max(0, current.price * (1 + (inputs.percent ?? 0) / 100)));
  const qty = inputs.expectedQty;
  const currentCost = round2(qty * current.price);
  const revisedCost = round2(qty * revisedPrice);
  const diff = round2(revisedCost - currentCost);
  const pct = currentCost > 0 ? diff / currentCost : null;

  const weights = new Map<string, number>();
  for (const a of facts.allocations) if (a.itemId === item.id) weights.set(a.projectId, (weights.get(a.projectId) ?? 0) + a.quantity);
  const extra = splitAmount(diff, inputs.projectIds, weights);
  const budget = budgetImpactTable(facts.projects, extra);
  const fyAfter = round2(facts.procurement.total + diff);
  const spent = sumOf(facts.projects, (p) => p.spent);

  const metrics = emptyMetrics();
  metrics.procurementCost = diff;
  metrics.projectCost = inputs.projectIds.length ? diff : null;
  metrics.overBudget = inputs.projectIds.length ? budget.overBudget : null;
  if (diff > 0) metrics.risks.push(`${item.name} costs ${formatCurrency(diff)} more for ${formatNumber(qty)} ${item.unit}`);
  for (const r of budget.table.rows) if (r.tone === "danger") metrics.risks.push(`${r.cells.project} goes over budget`);

  const notes = [
    `The current price is the ${PRICE_BASIS_LABEL[current.basis].toLowerCase()}${current.fellBack ? " because no purchase price is recorded" : ""}.`,
    inputs.projectIds.length
      ? splitIsWeighted(inputs.projectIds, weights)
        ? "The difference is split across the chosen projects in proportion to what each used of the material."
        : "None of the chosen projects has used this material yet, so the difference is split equally."
      : "No project was picked, so no project budget changes.",
    `Overall procurement is every stock purchase booked in ${facts.procurement.label}.`,
  ];
  if (!ctx.admin && inputs.projectIds.length) notes.push(SALARIES_NOTE);

  const direction = diff > 0 ? "additional expenditure" : diff < 0 ? "savings" : "no change";
  return {
    version: 1,
    type: "price",
    computedAt: new Date().toISOString(),
    view: ctx.admin ? "admin" : "member",
    headline: `At ${formatCurrency(revisedPrice)} instead of ${formatCurrency(current.price)} a ${item.unit}, ${formatNumber(qty)} ${item.unit} of ${item.name} cost ${formatCurrency(revisedCost)}: ${
      diff === 0 ? "no change" : `${formatCurrency(Math.abs(diff))} ${direction}`
    }${pct !== null && diff !== 0 ? ` (${formatPercent(pct)})` : ""}.`,
    stats: [
      stat("current", "Current price", "money", current.price, { hint: PRICE_BASIS_LABEL[current.basis] }),
      stat("revised", "Revised price", "money", revisedPrice),
      stat("diff", diff >= 0 ? "Additional expenditure" : "Savings", "money", Math.abs(diff), { tone: diff > 0 ? "danger" : diff < 0 ? "success" : "default", hint: pct !== null ? formatPercent(pct) : undefined }),
      stat("fy", `Procurement ${facts.procurement.label}`, "money", fyAfter, { hint: `was ${formatCurrency(facts.procurement.total)}` }),
    ],
    comparison: [
      compareRow("price", "Unit price", "money", current.price, revisedPrice),
      compareRow("cost", `Purchase cost of ${formatNumber(qty)} ${item.unit}`, "money", currentCost, revisedCost),
      compareRow("fy", `Stock purchases ${facts.procurement.label}`, "money", facts.procurement.total, fyAfter),
      ...(inputs.projectIds.length
        ? [compareRow("spent", "Spend of the chosen projects", "money", spent, round2(spent + diff))]
        : []),
    ],
    tables: [
      {
        key: "purchase",
        title: "Purchase cost",
        columns: [
          { key: "measure", header: "Measure", type: "text" },
          { key: "current", header: "Current", type: "money" },
          { key: "scenario", header: "Scenario", type: "money" },
          { key: "difference", header: "Difference", type: "money" },
        ],
        rows: [
          { cells: { measure: "Unit price", current: current.price, scenario: revisedPrice, difference: round2(revisedPrice - current.price) } },
          { cells: { measure: `Cost of ${formatNumber(qty)} ${item.unit}`, current: currentCost, scenario: revisedCost, difference: diff } },
          { cells: { measure: `This material's purchases ${facts.procurement.label}`, current: facts.procurement.itemTotal, scenario: null, difference: null } },
          { cells: { measure: `All stock purchases ${facts.procurement.label}`, current: facts.procurement.total, scenario: fyAfter, difference: diff } },
        ],
      },
      budget.table,
      {
        key: "history",
        title: "Recent purchases of this material",
        columns: [
          { key: "date", header: "Date", type: "date" },
          { key: "qty", header: "Quantity", type: "number" },
          { key: "unitCost", header: "Unit cost", type: "money" },
          { key: "vendor", header: "Vendor", type: "text" },
        ],
        rows: facts.purchases.map((p) => ({ cells: { date: p.date, qty: p.qty, unitCost: p.unitCost, vendor: p.vendor ?? "Not recorded" } })),
        emptyText: "No purchase of this material is recorded.",
      },
    ],
    chart: null,
    metrics,
    notes,
    notRecorded: [],
  };
}
