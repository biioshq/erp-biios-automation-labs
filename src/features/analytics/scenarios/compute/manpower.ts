import { DEPARTMENTS, labelOf, type Department } from "@/lib/constants";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { ManpowerInputs } from "../schemas";
import type { ResultTable, ScenarioResults } from "../types";
import type { ComputeContext, EmployeeFact, MembershipFact, ProjectFact } from "./facts";
import { budgetImpactTable, compareRow, emptyMetrics, periodMonths, round2, stat } from "./common";
import { averageSalary, departmentCapacity, personLoads } from "./capacity";

export type ManpowerFacts = {
  /** Active employees. */
  employees: EmployeeFact[];
  /** Open memberships of active employees. */
  memberships: MembershipFact[];
  /** Every project, for names. */
  projects: ProjectFact[];
};

const deptLabel = (d: string) => labelOf(DEPARTMENTS, d as Department);

/** Does a person fit the role or skill asked for? Empty asks match everyone. */
function fits(e: EmployeeFact, inputs: Pick<ManpowerInputs, "role" | "skill">): boolean {
  const skill = inputs.skill?.trim().toLowerCase();
  if (skill && !e.skills.some((s) => s.toLowerCase().includes(skill)) && !(e.designation ?? "").toLowerCase().includes(skill)) return false;
  return true;
}

/** 1.6 HR and manpower: people needed on a project or in a department against who is free. */
export function computeManpower(inputs: ManpowerInputs, facts: ManpowerFacts, ctx: ComputeContext): ScenarioResults {
  const months = periodMonths(inputs.periodFrom, inputs.periodTo);
  const capacity = departmentCapacity(facts.employees, facts.memberships);
  const loads = new Map(personLoads(facts.employees, facts.memberships).map((p) => [p.id, p]));
  const projectById = new Map(facts.projects.map((p) => [p.id, p]));
  const project = inputs.scope === "project" ? (projectById.get(inputs.projectId ?? "") ?? null) : null;
  const dept = inputs.scope === "department" ? (inputs.department as string) : null;

  // Who is there now, and who could be added without hiring.
  const team = project ? facts.memberships.filter((m) => m.projectId === project.id) : [];
  const teamIds = new Set(team.map((m) => m.employeeId));
  const deptPeople = dept ? facts.employees.filter((e) => e.department === dept) : [];
  const current = project ? teamIds.size : deptPeople.length;
  const currentFte = project ? round2(team.reduce((s, m) => s + Math.max(0, m.allocation), 0) / 100) : round2(capacity.get(dept ?? "")?.allocated ?? 0);
  // A department picked for a project narrows who could join and sets the salary average used.
  const poolDept = dept ?? inputs.department ?? null;
  const pool = facts.employees.filter((e) => !teamIds.has(e.id) && fits(e, inputs) && (!poolDept || e.department === poolDept));
  const poolFree = round2(pool.reduce((s, e) => s + (loads.get(e.id)?.free ?? 0), 0));

  const required = inputs.requiredCount;
  const additional = Math.max(0, required - current);
  const surplus = Math.max(0, current - required);
  // A department's free time is already its own people: more heads there means hiring.
  const internal = project ? Math.min(additional, Math.floor(poolFree)) : 0;
  const hiring = Math.max(0, additional - internal);

  const monthly = ctx.admin ? (inputs.monthlyCost ?? (poolDept ? averageSalary(facts.employees, poolDept) : null)) : null;
  const overtime = inputs.overtimeHours && inputs.overtimeRate ? round2(inputs.overtimeHours * inputs.overtimeRate * months) : 0;
  const additionalCost = monthly !== null ? round2(additional * monthly * months + overtime) : overtime || null;
  const hiringCost = monthly !== null ? round2(hiring * monthly * months) : null;
  const totalCost = monthly !== null ? round2(required * monthly * months + overtime) : null;

  const tables: ResultTable[] = [];
  if (project) {
    tables.push({
      key: "team",
      title: `Current team on ${project.name}`,
      columns: [
        { key: "person", header: "Person", type: "text" },
        { key: "department", header: "Department", type: "text" },
        { key: "role", header: "Role on project", type: "text" },
        { key: "here", header: "Time on this project", type: "percent" },
        { key: "total", header: "Time on all projects", type: "percent" },
      ],
      rows: team.map((m) => {
        const e = facts.employees.find((x) => x.id === m.employeeId);
        const load = loads.get(m.employeeId);
        return {
          cells: { person: e?.name ?? "Unknown", department: e ? deptLabel(e.department) : "", role: m.role, here: m.allocation / 100, total: load ? load.allocated : null },
          links: { person: `/finance/employees/${m.employeeId}` },
          tone: load?.overAllocated ? "warning" : undefined,
        };
      }),
      emptyText: "Nobody is on this project's team yet.",
    });
  }
  tables.push({
    key: "available",
    title: project ? "People with free time who could join" : `Free time in ${deptLabel(dept ?? "")}`,
    description: "Free time is the share of a person's time not taken by open memberships of projects that are not completed or cancelled.",
    columns: [
      { key: "person", header: "Person", type: "text" },
      { key: "department", header: "Department", type: "text" },
      { key: "free", header: "Free time", type: "percent" },
    ],
    rows: (project ? pool : deptPeople)
      .map((e) => ({ e, free: loads.get(e.id)?.free ?? 0 }))
      .filter((x) => x.free > 0)
      .sort((a, b) => b.free - a.free)
      .map(({ e, free }) => ({ cells: { person: e.name, department: deptLabel(e.department), free }, links: { person: `/finance/employees/${e.id}` } })),
    emptyText: inputs.skill ? `Nobody with "${inputs.skill}" has free time.` : "Nobody has free time: every active person is fully allocated to projects.",
  });
  tables.push({
    key: "departments",
    title: "Department utilisation",
    columns: [
      { key: "department", header: "Department", type: "text" },
      { key: "headcount", header: "Active people", type: "number" },
      { key: "allocated", header: "On projects (FTE)", type: "number" },
      { key: "free", header: "Free (FTE)", type: "number" },
      { key: "utilisation", header: "Utilisation", type: "percent" },
    ],
    rows: [...capacity.values()]
      .filter((d) => !dept || d.department === dept)
      .map((d) => ({ cells: { department: deptLabel(d.department), headcount: d.headcount, allocated: d.allocated, free: d.free, utilisation: d.headcount ? d.allocated / d.headcount : null } })),
    emptyText: "No active employees are recorded.",
  });
  if (dept) {
    const d = capacity.get(dept);
    tables.push({
      key: "projects",
      title: "Projects using this department",
      columns: [
        { key: "project", header: "Project", type: "text" },
        { key: "fte", header: "People (FTE)", type: "number" },
      ],
      rows: [...(d?.byProject ?? new Map<string, number>()).entries()].map(([id, fte]) => {
        const p = projectById.get(id);
        return { cells: { project: p ? `${p.name} (${p.code})` : "Another project", fte }, links: p ? { project: `/finance/projects/${id}` } : undefined };
      }),
      emptyText: "Nobody in this department is on a project.",
    });
  }

  let overBudget: number | null = null;
  if (project && additionalCost !== null) {
    const budget = budgetImpactTable([project], new Map([[project.id, additionalCost]]), "Effect on the project budget");
    tables.push(budget.table);
    overBudget = budget.overBudget;
  }

  const metrics = emptyMetrics();
  // People the company would have to add (hires), or the surplus on the team or department.
  metrics.manpowerPeople = additional > 0 ? hiring : -surplus;
  metrics.manpowerCost = additionalCost;
  metrics.projectCost = project ? additionalCost : null;
  metrics.overBudget = overBudget;
  if (hiring > 0) metrics.risks.push(`${hiring} ${hiring === 1 ? "person" : "people"} to hire${inputs.role ? ` as ${inputs.role}` : ""}`);
  if (overBudget) metrics.risks.push(`${project?.name} goes over budget`);

  const scopeName = project ? project.name : deptLabel(dept ?? "");
  const notes = [
    `The period covers about ${formatNumber(months)} months.`,
    project
      ? "People already on the team count once each, whatever share of their time they give it. Others can join without hiring only up to their free time, in whole people."
      : "A department's headcount is its active people. More heads there means hiring, since its free time is already its own people's.",
  ];
  if (ctx.admin) {
    notes.push(
      inputs.monthlyCost !== undefined
        ? `Costed at ${formatCurrency(inputs.monthlyCost)} a person a month, as entered.`
        : monthly !== null
          ? `Costed at the department's average monthly salary, ${formatCurrency(monthly)}.`
          : "No monthly cost was entered, so salary costs are not estimated.",
    );
  } else notes.push("Salary figures are shown to admins only.");
  if (overtime) notes.push(`Overtime: ${formatNumber(inputs.overtimeHours ?? 0)} hours a month for the team at ${formatCurrency(inputs.overtimeRate ?? 0)} an hour.`);

  const comparison = [
    compareRow("people", project ? "People on the team" : "People in the department", "number", current, required),
    compareRow("fte", project ? "Team time (FTE)" : "Department time on projects (FTE)", "number", currentFte, round2(currentFte + additional - surplus)),
  ];
  if (monthly !== null) comparison.push(compareRow("cost", "Manpower cost for the period", "money", round2(current * monthly * months), totalCost));
  if (project && additionalCost !== null) comparison.push(compareRow("spent", "Project spend", "money", project.spent, round2(project.spent + additionalCost)));

  return {
    version: 1,
    type: "manpower",
    computedAt: new Date().toISOString(),
    view: ctx.admin ? "admin" : "member",
    headline: `${scopeName} needs ${required} ${required === 1 ? "person" : "people"}${inputs.role ? ` (${inputs.role})` : ""} and has ${current}. ${
      additional > 0
        ? `${additional} more: ${internal ? `${internal} could come from people with free time, ` : ""}${hiring} to hire.`
        : surplus > 0
          ? `That is a surplus of ${surplus}.`
          : "That matches exactly."
    }${additionalCost !== null && monthly !== null ? ` Extra cost about ${formatCurrency(additionalCost)}.` : ""}`,
    stats: [
      stat("current", project ? "On the team now" : "In the department now", "number", current, { hint: `${formatNumber(currentFte)} FTE on projects` }),
      stat("additional", additional > 0 ? "Additional people needed" : "Surplus", "number", additional > 0 ? additional : surplus, { tone: additional > 0 ? "warning" : "default" }),
      stat("hiring", "To hire", "number", hiring, {
        tone: hiring > 0 ? "danger" : "success",
        hint: [project ? `${formatNumber(poolFree)} FTE free elsewhere` : null, hiringCost ? `hires cost ${formatCurrency(hiringCost)}` : null].filter(Boolean).join(", ") || undefined,
      }),
      stat("cost", "Estimated additional cost", "money", additionalCost, { hint: monthly === null && !overtime ? (ctx.admin ? "enter a monthly cost" : "admins only") : undefined }),
    ],
    comparison,
    tables,
    chart: null,
    metrics,
    notes: [...notes, ...(project ? [`Project budget used now: ${project.budget > 0 ? formatPercent(project.spent / project.budget) : "no budget set"}.`] : [])],
    notRecorded: [
      { label: "Roles and skills a project requires", detail: "Projects do not record the roles they need. Skills come from employee records and match by name." },
      { label: "Working hours", detail: "Hours worked are not recorded, so overtime is only what you enter." },
    ],
  };
}
