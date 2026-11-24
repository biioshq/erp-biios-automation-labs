import Link from "next/link";
import { Money } from "@/components/shared/money";
import { formatPercent } from "@/lib/format";
import { GridTable, ProjectCell, type Column } from "@/features/analytics/inventory/components/table-kit";
import type { ProjectCostRow } from "../queries";
import type { StageOverrun } from "../overrun-queries";

/** Tables of the cost overruns page. Server components. */

const project: Column<ProjectCostRow> = { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.id} name={r.name} code={r.code} color={r.color} /> };

/** The three categories that took the most of the project's spend, with their share. */
function Contributors({ r }: { r: ProjectCostRow }) {
  const top = r.byCategory.slice(0, 3);
  if (!top.length) return <span className="text-muted-foreground">No spend</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {top.map((c) => (
        <li key={c.category} className="flex justify-between gap-3">
          <Link href={`/finance/expenses?project=${r.id}&category=${encodeURIComponent(c.category)}`} className="truncate hover:underline">
            {c.label}
          </Link>
          <span className="tabular whitespace-nowrap text-muted-foreground">
            <Money value={c.amount} compact /> ({formatPercent(r.spent > 0 ? c.amount / r.spent : 0)})
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OverrunTable({ rows, stagesBy }: { rows: ProjectCostRow[]; stagesBy: Map<string, StageOverrun[]> }) {
  const columns: Column<ProjectCostRow>[] = [
    project,
    { key: "budget", header: "Budget", align: "right", cell: (r) => <Money value={r.budget} /> },
    { key: "spent", header: "Spent", align: "right", cell: (r) => <Money value={r.spent} /> },
    {
      key: "overrun",
      header: "Overrun",
      align: "right",
      cell: (r) => (
        <div>
          <Money value={r.overrun} className="font-medium text-danger" />
          <span className="block text-xs text-danger">{formatPercent(r.overrun / r.budget)}</span>
        </div>
      ),
    },
    {
      key: "original",
      header: "Against original budget",
      align: "right",
      cell: (r) => {
        const over = Math.round((r.spent - r.originalBudget) * 100) / 100;
        if (r.originalBudget === r.budget) return <span className="text-xs text-muted-foreground">Budget never revised</span>;
        return (
          <div>
            <Money value={over} tone="auto" />
            <span className="block text-xs text-muted-foreground">
              original <Money value={r.originalBudget} compact />
            </span>
          </div>
        );
      },
    },
    { key: "contributors", header: "Biggest cost categories", className: "min-w-56", cell: (r) => <Contributors r={r} /> },
    {
      key: "stages",
      header: "Stages over their budget",
      cell: (r) => {
        const s = stagesBy.get(r.id) ?? [];
        if (!s.length) return <span className="text-xs text-muted-foreground">{Object.values(r.stageBudgets).some((v) => v > 0) ? "None" : "No stage budgets"}</span>;
        return (
          <ul className="space-y-0.5 text-xs">
            {s.map((x) => (
              <li key={x.stage}>
                {x.stageLabel}: <Money value={x.over} className="text-danger" /> over
              </li>
            ))}
          </ul>
        );
      },
    },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={1100} />;
}

export function AtRiskTable({ rows }: { rows: ProjectCostRow[] }) {
  const columns: Column<ProjectCostRow>[] = [
    project,
    { key: "budget", header: "Budget", align: "right", cell: (r) => <Money value={r.budget} /> },
    { key: "spent", header: "Spent so far", align: "right", cell: (r) => <Money value={r.spent} /> },
    { key: "predicted", header: "Predicted final cost", align: "right", cell: (r) => <Money value={r.prediction.value} className="font-medium" /> },
    {
      key: "over",
      header: "Predicted overrun",
      align: "right",
      cell: (r) => (
        <div>
          <Money value={r.predictedOverrun} className="font-medium text-danger" />
          <span className="block text-xs text-danger">{formatPercent((r.predictedOverrun ?? 0) / r.budget)}</span>
        </div>
      ),
    },
    { key: "contributors", header: "Biggest cost categories", className: "min-w-56", cell: (r) => <Contributors r={r} /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={900} />;
}

export function StageOverrunTable({ rows }: { rows: StageOverrun[] }) {
  const columns: Column<StageOverrun>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.projectId} name={r.projectName} color={r.color} /> },
    { key: "stage", header: "Stage", cell: (r) => r.stageLabel },
    { key: "planned", header: "Stage budget", align: "right", cell: (r) => <Money value={r.planned} /> },
    { key: "spent", header: "Spent", align: "right", cell: (r) => <Money value={r.spent} /> },
    {
      key: "over",
      header: "Over by",
      align: "right",
      cell: (r) => (
        <span>
          <Money value={r.over} className="font-medium text-danger" /> <span className="text-xs text-danger">({formatPercent(r.over / r.planned)})</span>
        </span>
      ),
    },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => `${r.projectId}:${r.stage}`} minWidth={620} />;
}
