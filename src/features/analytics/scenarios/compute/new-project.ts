import { DEPARTMENTS, labelOf, type Department } from "@/lib/constants";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { NewProjectInputs } from "../schemas";
import type { ResultRow, ResultTable, ScenarioResults } from "../types";
import type { AllocationFact, CashFact, ComputeContext, EmployeeFact, EquipmentFact, ItemFact, MembershipFact, ProjectFact } from "./facts";
import { PRICE_BASIS_LABEL, compareRow, emptyMetrics, periodDays, periodMonths, priceOf, qtyByUnit, round2, round3, stat, sumOf } from "./common";
import { averageSalary, departmentCapacity } from "./capacity";

export type NewProjectFacts = {
  items: Map<string, ItemFact>;
  allocations: AllocationFact[];
  equipment: Map<string, EquipmentFact>;
  employees: EmployeeFact[];
  memberships: MembershipFact[];
  /** Every project (names of the ones affected; planned and active ones for the totals). */
  projects: ProjectFact[];
  /** Admins only. */
  cash: CashFact | null;
};

const UNUSABLE = new Set(["under_maintenance", "damaged", "lost", "disposed"]);
const day = (d: string | null) => (d ? formatDate(fromDateInput(d)) : "no end date");

type EquipmentLine = { label: string; requested: number; inRegister: number; usable: number; short: number; conflict: string | null; assetId: string | null };

/** Is the asset busy elsewhere during the window? Open-ended assignments always conflict. */
export function equipmentConflict(asset: EquipmentFact, start: string, excludeProjectId?: string): string | null {
  if (!asset.projectId || asset.projectId === excludeProjectId) return null;
  if (asset.projectUntil && asset.projectUntil < start) return null;
  return `With ${asset.projectName ?? "another project"} until ${day(asset.projectUntil)}`;
}

function equipmentLines(inputs: NewProjectInputs, equipment: Map<string, EquipmentFact>): EquipmentLine[] {
  return inputs.equipment.map((e) => {
    const asset = e.assetId ? equipment.get(e.assetId) : undefined;
    if (!asset) return { label: e.name ?? "Equipment", requested: e.qty, inRegister: 0, usable: 0, short: e.qty, conflict: e.assetId ? "No longer in the asset register" : "Not in the asset register", assetId: null };
    const conflict = equipmentConflict(asset, inputs.startDate);
    const unusable = UNUSABLE.has(asset.condition);
    const usable = conflict || unusable ? 0 : asset.quantity;
    return {
      label: `${asset.name} (${asset.code})`,
      requested: e.qty,
      inRegister: asset.quantity,
      usable,
      short: Math.max(0, e.qty - usable),
      conflict: conflict ?? (unusable ? `Condition: ${asset.condition.replace(/_/g, " ")}` : null),
      assetId: asset.id,
    };
  });
}

/** 1.3 New project: what a project that does not exist yet would need, against what the company has. Creates nothing. */
export function computeNewProject(inputs: NewProjectInputs, facts: NewProjectFacts, ctx: ComputeContext): ScenarioResults {
  const days = periodDays(inputs.startDate, inputs.endDate);
  const months = periodMonths(inputs.startDate, inputs.endDate);

  // Materials against storage.
  const materials = inputs.materials.flatMap((m) => {
    const item = facts.items.get(m.itemId);
    if (!item) return [];
    const p = priceOf(item, inputs.priceBasis);
    const short = round3(Math.max(0, m.qty - item.available));
    return [{ item, qty: m.qty, available: item.available, short, price: p.price, fellBack: p.fellBack, cost: round2(m.qty * p.price), buyCost: round2(short * p.price), fromStock: round2(Math.min(m.qty, item.available) * p.price) }];
  });
  const materialFromData = sumOf(materials, (m) => m.cost);
  const purchaseCost = sumOf(materials, (m) => m.buyCost);
  const stockValueUsed = sumOf(materials, (m) => m.fromStock);

  // Equipment against the register.
  const equip = equipmentLines(inputs, facts.equipment);
  const equipmentShort = equip.reduce((s, e) => s + e.short, 0);

  // Manpower against free capacity, department by department.
  const capacity = departmentCapacity(facts.employees, facts.memberships);
  const freeLeft = new Map([...capacity.values()].map((d) => [d.department, d.free]));
  const manpower = inputs.manpower.map((m) => {
    const free = freeLeft.get(m.department) ?? 0;
    const covered = Math.min(free, m.count);
    freeLeft.set(m.department, round2(free - covered));
    const salary = ctx.admin ? averageSalary(facts.employees, m.department) : null;
    return { ...m, free: round2(free), short: round2(Math.max(0, m.count - free)), cost: salary !== null ? round2(salary * m.count * m.months) : null, salary };
  });
  const peopleShort = round2(manpower.reduce((s, m) => s + m.short, 0));
  const labourFromData = ctx.admin && manpower.length && manpower.every((m) => m.cost !== null) ? sumOf(manpower, (m) => m.cost ?? 0) : null;

  // The estimate: what was entered, else what the ERP's own figures give.
  const labour = inputs.labourCost ?? labourFromData ?? 0;
  const material = inputs.materialCost ?? materialFromData;
  const equipmentCost = inputs.equipmentCost ?? 0;
  const other = inputs.otherCost ?? 0;
  const total = round2(labour + material + equipmentCost + other);
  // Stock on hand was paid for when it was bought, so it needs no new cash.
  const cashNeed = round2(Math.max(0, total - Math.min(stockValueUsed, material)));
  const budget = inputs.proposedBudget ?? null;
  const gap = budget !== null ? round2(total - budget) : null;

  // Existing projects that would feel it.
  const impact = new Map<string, string[]>();
  const add = (projectId: string, text: string) => impact.set(projectId, [...(impact.get(projectId) ?? []), text]);
  for (const e of equip) {
    const asset = e.assetId ? facts.equipment.get(e.assetId) : undefined;
    if (asset?.projectId && e.conflict?.startsWith("With")) add(asset.projectId, `Has ${asset.name} until ${day(asset.projectUntil)}`);
  }
  for (const m of materials.filter((x) => x.short > 0)) {
    for (const a of facts.allocations) if (a.itemId === m.item.id && a.inUse > 0) add(a.projectId, `Holds ${formatNumber(a.inUse)} ${m.item.unit} of ${m.item.name}, which is short`);
  }
  for (const m of manpower.filter((x) => x.short > 0)) {
    const dept = capacity.get(m.department);
    for (const [projectId, fte] of dept?.byProject ?? []) add(projectId, `Uses ${formatNumber(fte)} FTE of ${labelOf(DEPARTMENTS, m.department as Department)}, which is short`);
  }
  const projectById = new Map(facts.projects.map((p) => [p.id, p]));

  const metrics = emptyMetrics();
  metrics.materials = materials.length ? qtyByUnit(materials.map((m) => ({ unit: m.item.unit, qty: m.qty }))) : null;
  metrics.procurementCost = purchaseCost;
  metrics.projectCost = total;
  metrics.overBudget = gap !== null ? Math.max(0, gap) : null;
  metrics.manpowerPeople = manpower.length ? peopleShort : null;
  metrics.budgetChange = budget;
  metrics.manpowerCost = inputs.labourCost ?? labourFromData;
  metrics.equipmentShort = equip.length ? equipmentShort : null;
  metrics.equipmentCost = inputs.equipmentCost ?? null;
  metrics.shortItems = materials.filter((m) => m.short > 0).length;
  metrics.cashNeed = ctx.admin ? cashNeed : null;
  for (const m of materials.filter((x) => x.short > 0)) metrics.risks.push(`${m.item.name}: ${formatNumber(m.short)} ${m.item.unit} to buy`);
  for (const e of equip.filter((x) => x.short > 0)) metrics.risks.push(`${e.label}: ${e.short} short${e.conflict ? ` (${e.conflict.toLowerCase()})` : ""}`);
  for (const m of manpower.filter((x) => x.short > 0)) metrics.risks.push(`${labelOf(DEPARTMENTS, m.department as Department)}: ${formatNumber(m.short)} FTE short`);
  if (gap !== null && gap > 0) metrics.risks.push(`Estimated cost is ${formatCurrency(gap)} above the proposed budget`);
  if (ctx.admin && facts.cash && cashNeed > facts.cash.total) metrics.risks.push(`Needs ${formatCurrency(cashNeed - facts.cash.total)} more cash than the company holds`);

  const running = facts.projects.filter((p) => p.status === "planning" || p.status === "active");
  const activeBudget = sumOf(running, (p) => p.budget);
  const freeFte = round2([...capacity.values()].reduce((s, d) => s + d.free, 0));
  const comparison = [
    compareRow("projects", "Planned and active projects", "number", running.length, running.length + 1),
    compareRow("budgets", "Budgets of planned and active projects", "money", activeBudget, round2(activeBudget + (budget ?? total))),
    compareRow("freeFte", "Free people across the company (FTE)", "number", freeFte, round2(Math.max(0, freeFte - (manpower.reduce((s, m) => s + m.count, 0) - peopleShort)))),
    compareRow("short", "Materials short", "number", 0, metrics.shortItems),
  ];
  if (ctx.admin && facts.cash) comparison.push(compareRow("cash", "Cash and bank balances", "money", facts.cash.total, round2(facts.cash.total - cashNeed)));

  const costRows: ResultRow[] = [
    { cells: { line: "Labour", entered: inputs.labourCost ?? null, data: labourFromData, used: labour } },
    { cells: { line: "Materials", entered: inputs.materialCost ?? null, data: materialFromData, used: material } },
    { cells: { line: "Equipment", entered: inputs.equipmentCost ?? null, data: null, used: equipmentCost } },
    { cells: { line: "Other", entered: inputs.otherCost ?? null, data: null, used: other } },
  ];

  const tables: ResultTable[] = [
    {
      key: "cost",
      title: "Cost estimate",
      description: ctx.admin
        ? "Used is the figure you entered, or the ERP's own estimate when you left it empty: materials at stock prices, labour at the department's average salary."
        : "Used is the figure you entered, or for materials the cost at stock prices when you left it empty. Salary-based labour estimates are shown to admins only, so labour counts as zero unless you enter it.",
      columns: [
        { key: "line", header: "Cost", type: "text" },
        { key: "entered", header: "Entered", type: "money" },
        { key: "data", header: "From ERP data", type: "money" },
        { key: "used", header: "Used", type: "money" },
      ],
      rows: costRows,
      totals: { line: "Total estimated cost", used: total },
    },
    {
      key: "materials",
      title: "Material requirements",
      columns: [
        { key: "material", header: "Material", type: "text" },
        { key: "qty", header: "Required", type: "number" },
        { key: "available", header: "Available in storage", type: "number" },
        { key: "short", header: "To purchase", type: "number" },
        { key: "price", header: "Unit price", type: "money" },
        { key: "cost", header: "Material cost", type: "money" },
        { key: "buyCost", header: "Purchase cost", type: "money" },
      ],
      rows: materials.map((m) => ({
        cells: { material: `${m.item.name} (${m.item.unit})`, qty: m.qty, available: m.available, short: m.short, price: m.price, cost: m.cost, buyCost: m.buyCost },
        links: { material: `/inventory/items/${m.item.id}` },
        tone: m.short > 0 ? "danger" : undefined,
      })),
      totals: materials.length ? { material: "Total", cost: materialFromData, buyCost: purchaseCost } : null,
      emptyText: "No materials listed.",
    },
    {
      key: "equipment",
      title: "Equipment availability",
      description: "Equipment from the fixed asset register. An item assigned to another project counts as unavailable unless it comes back before the start date.",
      columns: [
        { key: "equipment", header: "Equipment", type: "text" },
        { key: "requested", header: "Needed", type: "number" },
        { key: "inRegister", header: "In register", type: "number" },
        { key: "usable", header: "Available", type: "number" },
        { key: "short", header: "Short", type: "number" },
        { key: "conflict", header: "Conflict", type: "text" },
      ],
      rows: equip.map((e) => ({
        cells: { equipment: e.label, requested: e.requested, inRegister: e.inRegister, usable: e.usable, short: e.short, conflict: e.conflict ?? "None" },
        links: e.assetId ? { equipment: `/finance/assets/fixed?view=${e.assetId}` } : undefined,
        tone: e.short > 0 ? "danger" : undefined,
      })),
      emptyText: "No equipment listed.",
    },
    {
      key: "manpower",
      title: "Manpower availability",
      description: "Free capacity is each active person's time not taken by open memberships of projects that are not completed or cancelled, in full-time equivalents (FTE).",
      columns: [
        { key: "department", header: "Department", type: "text" },
        { key: "role", header: "Role", type: "text" },
        { key: "count", header: "Needed", type: "number" },
        { key: "months", header: "Months", type: "number" },
        { key: "free", header: "Free capacity (FTE)", type: "number" },
        { key: "short", header: "Additional people", type: "number" },
        ...(ctx.admin ? [{ key: "cost", header: "Cost at average salary", type: "money" as const }] : []),
      ],
      rows: manpower.map((m) => ({
        cells: { department: labelOf(DEPARTMENTS, m.department as Department), role: m.role ?? "Any", count: m.count, months: m.months, free: m.free, short: m.short, ...(ctx.admin ? { cost: m.cost } : {}) },
        tone: m.short > 0 ? "danger" : undefined,
      })),
      emptyText: "No manpower listed.",
    },
    {
      key: "impact",
      title: "Impact on existing projects",
      description: "Projects that hold equipment, stock or people the new project would compete for.",
      columns: [
        { key: "project", header: "Project", type: "text" },
        { key: "how", header: "How it is affected", type: "text" },
      ],
      rows: [...impact.entries()].map(([id, reasons]) => {
        const p = projectById.get(id);
        return { cells: { project: p ? `${p.name} (${p.code})` : "Another project", how: [...new Set(reasons)].join("; ") }, links: p ? { project: `/finance/projects/${id}` } : undefined };
      }),
      emptyText: "No existing project would have to give up equipment, stock or people.",
    },
  ];

  if (ctx.admin) {
    tables.push({
      key: "feasibility",
      title: "Cash and budget feasibility",
      columns: [
        { key: "measure", header: "Measure", type: "text" },
        { key: "value", header: "Amount", type: "money" },
      ],
      rows: [
        { cells: { measure: "Total estimated cost", value: total } },
        { cells: { measure: "Covered by stock already paid for", value: round2(total - cashNeed) } },
        { cells: { measure: "Estimated cash requirement", value: cashNeed } },
        { cells: { measure: "Cash and bank balances today", value: facts.cash?.total ?? null } },
        { cells: { measure: "Cash left after the project", value: facts.cash ? round2(facts.cash.total - cashNeed) : null }, tone: facts.cash && facts.cash.total < cashNeed ? "danger" : undefined },
        { cells: { measure: "Proposed budget", value: budget } },
        { cells: { measure: "Budget surplus or shortfall", value: gap !== null ? round2(-gap) : null }, tone: gap !== null && gap > 0 ? "danger" : undefined },
      ],
    });
  }

  const feasible = gap === null ? null : gap <= 0;
  const headline = `${inputs.projectName} would cost about ${formatCurrency(total)} over ${formatNumber(days)} days. ${
    feasible === null ? "No budget was proposed." : feasible ? `The proposed budget of ${formatCurrency(budget)} covers it.` : `That is ${formatCurrency(gap)} more than the proposed budget.`
  } ${[
    metrics.shortItems ? `${metrics.shortItems} ${metrics.shortItems === 1 ? "material" : "materials"} to buy` : null,
    equipmentShort ? `${equipmentShort} equipment ${equipmentShort === 1 ? "unit" : "units"} short` : null,
    peopleShort ? `${formatNumber(peopleShort)} FTE of people short` : null,
  ].filter(Boolean).join(", ") || "Stock, equipment and people on record cover it."}`;

  const notes = [
    `Duration ${formatNumber(days)} days (about ${formatNumber(months)} months).`,
    `Materials are priced at the ${PRICE_BASIS_LABEL[inputs.priceBasis].toLowerCase()}${materials.some((m) => m.fellBack) ? "; materials with no purchase price recorded use their average cost" : ""}.`,
    "The cash requirement leaves out materials taken from stock that is already paid for.",
  ];
  if (!ctx.admin) notes.push("Cash balances and salary-based labour costs are shown to admins only.");
  if (inputs.scope) notes.push(`Scope: ${inputs.scope}`);
  if (inputs.size) notes.push(`Size: ${inputs.size}`);

  return {
    version: 1,
    type: "new_project",
    computedAt: new Date().toISOString(),
    view: ctx.admin ? "admin" : "member",
    headline,
    stats: [
      stat("total", "Total estimated cost", "money", total),
      stat("buy", "Materials to purchase", "money", purchaseCost, { hint: `${metrics.shortItems} items`, tone: purchaseCost > 0 ? "warning" : "default" }),
      stat("people", "Additional people needed", "number", peopleShort, { tone: peopleShort > 0 ? "danger" : "success" }),
      ctx.admin
        ? stat("cash", "Estimated cash requirement", "money", cashNeed, { hint: facts.cash ? `${formatCurrency(facts.cash.total)} in cash and bank` : undefined, tone: facts.cash && cashNeed > facts.cash.total ? "danger" : "default" })
        : stat("budget", "Budget surplus or shortfall", "money", gap !== null ? round2(-gap) : null, { tone: gap !== null && gap > 0 ? "danger" : "default" }),
    ],
    comparison,
    tables,
    chart: {
      title: "Estimated cost by line",
      type: "money",
      currentLabel: "Entered",
      scenarioLabel: "Used",
      points: costRows.map((r) => ({ label: String(r.cells.line), current: Number(r.cells.entered ?? 0), scenario: Number(r.cells.used ?? 0) })),
    },
    metrics,
    notes,
    notRecorded: [
      { label: "Role requirements and skills per project", detail: "The ERP records people's departments and project allocations, not the roles a project needs, so availability is checked by department." },
      { label: "Equipment bookings", detail: "Equipment is assigned to one project at a time with an end date. Future bookings are not recorded." },
    ],
  };
}
