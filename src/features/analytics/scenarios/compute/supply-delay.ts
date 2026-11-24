import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SupplyDelayInputs } from "../schemas";
import type { ScenarioResults } from "../types";
import type { ComputeContext, ItemFact, ProjectFact } from "./facts";
import { PRICE_BASIS_LABEL, compareRow, daysBetween, emptyMetrics, priceOf, round2, round3, shiftDate, stat, wholeUp, viewOf } from "./common";

export type SupplyDelayFacts = {
  item: ItemFact;
  /** From the analytics core's coverage(): null without a recorded rate. */
  coverage: { daysOfCover: number | null; stockoutDate: string | null };
  /** Projects that used the material in the usage window, plus the ones picked, with their recent use. */
  projects: (ProjectFact & { usedInWindow: number; lastIssued: string | null; picked: boolean })[];
};

const show = (d: string | null) => (d ? formatDate(fromDateInput(d)) : "not known");

/** 1.2 Supply delay: a delivery of one material arrives later than expected. */
export function computeSupplyDelay(inputs: SupplyDelayInputs, facts: SupplyDelayFacts, ctx: ComputeContext): ScenarioResults {
  const { item, coverage } = facts;
  const delayDays = inputs.delay * (inputs.delayUnit === "weeks" ? 7 : 1);
  const original = inputs.originalDelivery;
  const revised = shiftDate(original, delayDays);
  const perDay = item.perDay;
  const stockout = coverage.stockoutDate;
  const gapNow = stockout ? Math.max(0, daysBetween(stockout, original)) : null;
  const gap = stockout ? Math.max(0, daysBetween(stockout, revised)) : null;
  // Units needed before the delivery arrives, beyond what storage holds.
  const needUntil = (date: string) => (perDay ? wholeUp(Math.max(0, perDay * Math.max(0, daysBetween(ctx.today, date)) - item.available), item.unit) : null);
  const bridgeNow = needUntil(original);
  const bridge = needUntil(revised);
  const extraBridge = bridge !== null && bridgeNow !== null ? round3(bridge - bridgeNow) : null;
  const p = priceOf(item, inputs.priceBasis);
  const impact = extraBridge !== null ? round2(extraBridge * p.price) : null;

  const metrics = emptyMetrics();
  metrics.delayDays = gap;
  metrics.materials = extraBridge !== null ? [{ unit: item.unit, qty: extraBridge }] : null;
  metrics.procurementCost = impact;
  metrics.shortItems = gap !== null ? (gap > 0 ? 1 : 0) : null;
  if (gap && gap > 0) metrics.risks.push(`${item.name} runs out ${gap} days before the delayed delivery`);
  if (!perDay) metrics.risks.push(`No recorded use of ${item.name}: a stockout date cannot be worked out`);
  if (gap && gap > 0) for (const pr of facts.projects) metrics.risks.push(`${pr.name} could slip up to ${gap} days`);

  const comparison = [
    compareRow("delivery", "Expected delivery", "date", original, revised),
    compareRow("gap", "Days without stock before the delivery", "number", gapNow, gap, "days"),
    compareRow("bridge", "Units to buy elsewhere to bridge the gap", "number", bridgeNow, bridge, item.unit),
    compareRow("bridgeCost", "Cost of bridging stock", "money", bridgeNow !== null ? round2(bridgeNow * p.price) : null, bridge !== null ? round2(bridge * p.price) : null),
  ];

  const headline = !perDay
    ? `The delivery moves from ${show(original)} to ${show(revised)}. ${item.name} has no recorded use in the last ${item.windowDays} days, so the ERP cannot say when it would run out.`
    : gap && gap > 0
      ? `${item.name} runs out on ${show(stockout)}, ${gap} days before the delayed delivery on ${show(revised)}. Bridging that needs about ${formatNumber(bridge ?? 0)} ${item.unit} (${formatCurrency(bridge !== null ? round2(bridge * p.price) : 0)}).`
      : `Stock lasts until ${show(stockout)}, past the delayed delivery on ${show(revised)}, so the delay causes no stockout at the recent rate of use.`;

  const notes = [
    perDay
      ? `Average daily consumption is the net units issued to projects over the last ${item.windowDays} days (${formatNumber(round3(perDay))} ${item.unit} a day). Wastage is not counted as use.`
      : `No units were issued to projects in the last ${item.windowDays} days, so there is no rate of use.`,
    `Bridging stock is priced at the ${PRICE_BASIS_LABEL[p.basis].toLowerCase()}${p.fellBack ? " (no purchase price is recorded)" : ""}. The financial impact counts only that stock: penalties, idle labour and rush charges are not recorded in the ERP.`,
    "Potential project delay is the days between the stockout and the delayed delivery, for every project using the material.",
  ];
  if (inputs.vendor && item.vendor && inputs.vendor.trim().toLowerCase() !== item.vendor.trim().toLowerCase()) {
    notes.push(`The item's usual vendor on record is ${item.vendor}.`);
  }

  return {
    version: 1,
    type: "supply_delay",
    computedAt: new Date().toISOString(),
    view: viewOf(ctx),
    headline,
    stats: [
      stat("revised", "Revised delivery", "date", revised, { hint: `was ${show(original)}` }),
      stat("stockout", "Potential stockout", "date", stockout, { hint: coverage.daysOfCover !== null ? `${formatNumber(coverage.daysOfCover)} days of stock left` : "no recorded use", tone: gap ? "danger" : "default" }),
      stat("delay", "Potential project delay", "number", gap, { unit: "days", tone: gap === null ? "default" : gap > 0 ? "danger" : "success" }),
      stat("impact", "Estimated financial impact", "money", impact, { hint: impact === null ? "needs a rate of use" : "bridging stock only", tone: impact ? "warning" : "default" }),
    ],
    comparison,
    tables: [
      {
        key: "stock",
        title: "Stock position",
        columns: [
          { key: "measure", header: "Measure", type: "text" },
          { key: "value", header: "Value", type: "text" },
        ],
        rows: [
          { cells: { measure: "Material", value: `${item.name} (${item.sku})` }, links: { value: `/inventory/items/${item.id}` } },
          { cells: { measure: "Vendor", value: inputs.vendor ?? item.vendor ?? "Not recorded" } },
          { cells: { measure: "Available in storage", value: `${formatNumber(item.available)} ${item.unit}` } },
          { cells: { measure: "Average daily consumption", value: perDay ? `${formatNumber(round3(perDay))} ${item.unit}` : "No recorded use" } },
          { cells: { measure: "Days of stock left", value: coverage.daysOfCover !== null ? formatNumber(coverage.daysOfCover) : "Not known" } },
          { cells: { measure: "Potential stockout date", value: show(stockout) } },
          { cells: { measure: "Original delivery", value: show(original) } },
          { cells: { measure: `Delay`, value: `${delayDays} days` } },
          { cells: { measure: "Revised delivery", value: show(revised) } },
          ...(inputs.orderQty !== undefined ? [{ cells: { measure: "Units arriving late", value: `${formatNumber(inputs.orderQty)} ${item.unit}` } }] : []),
          { cells: { measure: "Additional procurement requirement", value: extraBridge !== null ? `${formatNumber(extraBridge)} ${item.unit}` : "Not known" } },
        ],
      },
      {
        key: "projects",
        title: "Projects affected",
        description: `Projects that were issued this material in the last ${item.windowDays} days, and any you picked.`,
        columns: [
          { key: "project", header: "Project", type: "text" },
          { key: "used", header: `Used in last ${item.windowDays} days`, type: "number" },
          { key: "last", header: "Last issued", type: "date" },
          { key: "delay", header: "Potential delay (days)", type: "number" },
        ],
        rows: facts.projects.map((pr) => ({
          cells: { project: `${pr.name} (${pr.code})`, used: pr.usedInWindow, last: pr.lastIssued, delay: gap },
          links: { project: `/finance/projects/${pr.id}` },
          tone: gap ? "danger" : undefined,
        })),
        emptyText: `No project used this material in the last ${item.windowDays} days and none was picked.`,
      },
    ],
    chart: null,
    metrics,
    notes,
    notRecorded: [
      { label: "Purchase orders", detail: "Purchase orders are not recorded in the ERP, so the delivery cannot be linked to an order. The delivery date and quantity are the ones you entered." },
    ],
  };
}
