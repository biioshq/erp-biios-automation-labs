import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FooterRow, GridTable, ProjectCell, type Column } from "@/features/analytics/inventory/components/table-kit";
import { SPEND_TYPES } from "@/lib/project-cost-types";
import { sumOf } from "../model";
import type { ProjectCostRow } from "../queries";

/** Tables of the project cost analysis and budget pages. Server components. */

const project: Column<ProjectCostRow> = {
  key: "project",
  header: "Project",
  cell: (r) => <ProjectCell id={r.id} name={r.name} code={r.code} color={r.color} />,
};
const status: Column<ProjectCostRow> = { key: "status", header: "Status", hideOnPhone: true, cell: (r) => <ProjectStatusBadge status={r.status} /> };

function Prediction({ r }: { r: ProjectCostRow }) {
  const f = r.prediction;
  if (f.value === null) {
    return (
      <div className="max-w-40 text-right text-xs whitespace-normal">
        <span className="block text-muted-foreground">{f.note}</span>
        {f.overrun > 0 ? (
          <span className="block text-danger">
            Already <Money value={f.overrun} /> over budget
          </span>
        ) : null}
      </div>
    );
  }
  const over = f.basis !== "actual" && f.overrun > 0;
  return (
    <div className="text-right" title={f.note}>
      <Money value={f.value} className={cn("font-medium", over && "text-danger")} />
      {f.basis !== "rate" && f.label ? <span className="block text-xs text-muted-foreground">{f.label}</span> : null}
      {over ? (
        <span className="block text-xs text-danger">
          <Money value={f.overrun} /> over budget
        </span>
      ) : null}
    </div>
  );
}

/** Budget, spend by cost type, what is left and the predicted final cost per project. */
export function CostTable({ rows }: { rows: ProjectCostRow[] }) {
  const columns: Column<ProjectCostRow>[] = [
    project,
    status,
    { key: "budget", header: "Estimated cost (budget)", align: "right", cell: (r) => (r.budget > 0 ? <Money value={r.budget} /> : <span className="text-muted-foreground">No budget</span>) },
    { key: "spent", header: "Actual expenditure", align: "right", cell: (r) => <Money value={r.spent} className="font-medium" /> },
    ...SPEND_TYPES.map((t) => ({
      key: t.key,
      header: t.label,
      align: "right" as const,
      cell: (r: ProjectCostRow) => (r.byType[t.key] ? <Money value={r.byType[t.key]} /> : <span className="text-muted-foreground">0</span>),
    })),
    { key: "remaining", header: "Remaining estimated", align: "right", cell: (r) => <Money value={r.estimatedRemaining} /> },
    { key: "predicted", header: "Predicted final cost", align: "right", cell: (r) => <Prediction r={r} /> },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      minWidth={1280}
      footer={
        <FooterRow
          cells={[
            { content: "Total" },
            { content: "", className: "hidden sm:table-cell" },
            { content: <Money value={sumOf(rows, (r) => r.budget)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.spent)} />, align: "right" },
            ...SPEND_TYPES.map((t) => ({ content: <Money value={sumOf(rows, (r) => r.byType[t.key])} />, align: "right" as const })),
            { content: <Money value={sumOf(rows, (r) => r.estimatedRemaining)} />, align: "right" },
            { content: "" },
          ]}
        />
      }
    />
  );
}

function Utilisation({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">No budget</span>;
  const tone = value > 1 ? "bg-danger" : value > 0.85 ? "bg-warning" : "bg-success";
  return (
    <div className="flex min-w-28 items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </span>
      <span className={cn("tabular w-12 text-right text-xs", value > 1 ? "font-medium text-danger" : "text-muted-foreground")}>{formatPercent(value)}</span>
    </div>
  );
}

/** Original and revised budget against actual spend. */
export function BudgetTable({ rows }: { rows: ProjectCostRow[] }) {
  const columns: Column<ProjectCostRow>[] = [
    project,
    status,
    { key: "original", header: "Original budget", align: "right", cell: (r) => <Money value={r.originalBudget} /> },
    {
      key: "revised",
      header: "Revised budget",
      align: "right",
      cell: (r) => (
        <div>
          <Money value={r.budget} />
          {r.budgetHistory.length ? <span className="block text-xs text-muted-foreground">{r.budgetHistory.length === 1 ? "Revised once" : `Revised ${r.budgetHistory.length} times`}</span> : null}
        </div>
      ),
    },
    { key: "spent", header: "Actual", align: "right", cell: (r) => <Money value={r.spent} className="font-medium" /> },
    { key: "remaining", header: "Remaining", align: "right", cell: (r) => <Money value={Math.max(0, r.remainingBudget)} /> },
    { key: "use", header: "Utilisation", cell: (r) => <Utilisation value={r.utilisation} /> },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      cell: (r) => (r.budget > 0 ? <Money value={r.remainingBudget} tone="auto" className="font-medium" /> : <span className="text-muted-foreground">No budget</span>),
    },
    {
      key: "vsOriginal",
      header: "Against original",
      align: "right",
      cell: (r) => (r.originalBudget > 0 ? <Money value={Math.round((r.originalBudget - r.spent) * 100) / 100} tone="auto" /> : <span className="text-muted-foreground">No budget</span>),
    },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      minWidth={1060}
      footer={
        <FooterRow
          cells={[
            { content: "Total" },
            { content: "", className: "hidden sm:table-cell" },
            { content: <Money value={sumOf(rows, (r) => r.originalBudget)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.budget)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.spent)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => Math.max(0, r.remainingBudget))} />, align: "right" },
            { content: "" },
            { content: <Money value={sumOf(rows.filter((r) => r.budget > 0), (r) => r.remainingBudget)} tone="auto" />, align: "right" },
            { content: "" },
          ]}
        />
      }
    />
  );
}
