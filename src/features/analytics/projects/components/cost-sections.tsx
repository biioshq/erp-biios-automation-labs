import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FooterRow, GridTable, ProjectCell, WrapHead, type Column } from "@/features/analytics/inventory/components/table-kit";
import { PROJECT_STATUSES, labelOf } from "@/lib/constants";
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
      <div className="ml-auto max-w-36 text-right text-xs whitespace-normal">
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
      {f.basis !== "rate" && f.label ? <span className="ml-auto block max-w-32 text-xs whitespace-normal text-muted-foreground">{f.label}</span> : null}
      {over ? (
        <span className="ml-auto block max-w-32 text-xs whitespace-normal text-danger">
          <Money value={f.overrun} /> over budget
        </span>
      ) : null}
    </div>
  );
}

/**
 * Budget, spend by cost type, what is left and the predicted final cost per project. Sized to fit a
 * full-width card at 1440px: the status sits under the project name, long headers wrap, and the
 * cost types show short amounts (the exact amount is in each one's tooltip).
 */
export function CostTable({ rows }: { rows: ProjectCostRow[] }) {
  const columns: Column<ProjectCostRow>[] = [
    {
      key: "project",
      header: "Project",
      cell: (r) => <ProjectCell id={r.id} name={r.name} code={`${r.code} · ${labelOf(PROJECT_STATUSES, r.status)}`} color={r.color} />,
    },
    {
      key: "budget",
      header: <WrapHead>Estimated cost (budget)</WrapHead>,
      align: "right",
      cell: (r) => (r.budget > 0 ? <Money value={r.budget} /> : <span className="text-muted-foreground">No budget</span>),
    },
    { key: "spent", header: <WrapHead>Actual expenditure</WrapHead>, align: "right", cell: (r) => <Money value={r.spent} className="font-medium" /> },
    ...SPEND_TYPES.map((t) => ({
      key: t.key,
      header: t.key === "transport" ? "Transport" : t.label,
      align: "right" as const,
      cell: (r: ProjectCostRow) => (r.byType[t.key] ? <Money value={r.byType[t.key]} compact /> : <span className="text-muted-foreground">-</span>),
    })),
    { key: "remaining", header: <WrapHead>Remaining estimated</WrapHead>, align: "right", cell: (r) => <Money value={r.estimatedRemaining} /> },
    { key: "predicted", header: <WrapHead>Predicted final cost</WrapHead>, align: "right", cell: (r) => <Prediction r={r} /> },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      minWidth={1000}
      footer={
        <FooterRow
          cells={[
            { content: "Total" },
            { content: <Money value={sumOf(rows, (r) => r.budget)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.spent)} />, align: "right" },
            ...SPEND_TYPES.map((t) => ({ content: <Money value={sumOf(rows, (r) => r.byType[t.key])} compact />, align: "right" as const })),
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
    { key: "use", header: "Utilisation", cell: (r) => <Utilisation value={r.utilisation} /> },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      cell: (r) => (r.budget > 0 ? <Money value={r.remainingBudget} tone="auto" className="font-medium" /> : <span className="text-muted-foreground">No budget</span>),
    },
    {
      key: "vsOriginal",
      header: <WrapHead>Against original</WrapHead>,
      align: "right",
      cell: (r) => (r.originalBudget > 0 ? <Money value={Math.round((r.originalBudget - r.spent) * 100) / 100} tone="auto" /> : <span className="text-muted-foreground">No budget</span>),
    },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      minWidth={940}
      footer={
        <FooterRow
          cells={[
            { content: "Total" },
            { content: "", className: "hidden sm:table-cell" },
            { content: <Money value={sumOf(rows, (r) => r.originalBudget)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.budget)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.spent)} />, align: "right" },
            { content: "" },
            { content: <Money value={sumOf(rows.filter((r) => r.budget > 0), (r) => r.remainingBudget)} tone="auto" />, align: "right" },
            { content: "" },
          ]}
        />
      }
    />
  );
}
