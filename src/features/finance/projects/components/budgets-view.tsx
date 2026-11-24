"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { BUDGET_TEXT_CLASS, budgetTone } from "../utils";
import type { ProjectFinanceRow } from "../types";
import { BudgetBar } from "./project-budget-bar";

/** One stage of one project that has a stage budget set. */
export type StageBudgetRow = {
  key: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  color: string;
  stageLabel: string;
  planned: number;
  spent: number;
  /** planned - spent: negative when the stage is over its budget. */
  variance: number;
};

function ProjectLink({ id, name, code, color }: { id: string; name: string; code: string; color: string }) {
  return (
    <Link href={`/finance/projects/${id}?tab=budget`} className="flex min-w-44 items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium hover:underline">{name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{code}</span>
      </span>
    </Link>
  );
}

const moneyCol = (id: string, title: string, pick: (r: ProjectFinanceRow) => number, className?: (r: ProjectFinanceRow) => string | undefined): ColumnDef<ProjectFinanceRow> => ({
  id,
  accessorFn: pick,
  meta: { label: title, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => <Money value={pick(row.original)} className={className?.(row.original)} />,
});

/** Original and revised budget against actual spend, per project. */
export function BudgetTrackingTable({ rows }: { rows: ProjectFinanceRow[] }) {
  const router = useRouter();
  // Columns that would only repeat another one are left out, so the table fits its card: the
  // original budget when no project's budget was revised, and the overrun when nothing is over.
  const revised = rows.some((r) => Math.abs(r.originalBudget - r.budget) >= 0.01);
  const overrun = rows.some((r) => r.outlook.overrun > 0);
  const columns = useMemo<ColumnDef<ProjectFinanceRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Project" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <ProjectLink {...row.original} />,
        enableHiding: false,
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <ProjectStatusBadge status={row.original.status} />,
      },
      ...(revised ? [moneyCol("originalBudget", "Original budget", (r) => r.originalBudget, () => "text-muted-foreground")] : []),
      moneyCol("budget", revised ? "Revised budget" : "Budget", (r) => r.budget),
      moneyCol("spent", "Spent", (r) => r.finance.spent, () => "font-medium"),
      moneyCol("remaining", "Remaining", (r) => r.outlook.remainingBudget, (r) => (r.outlook.remainingBudget < 0 ? "text-danger" : undefined)),
      {
        id: "usage",
        accessorFn: (r) => r.outlook.utilisation ?? -1,
        meta: { label: "Utilisation" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Utilisation" />,
        cell: ({ row }) => {
          const r = row.original;
          const tone = budgetTone(r.usage, r.budget);
          return (
            <div className="flex min-w-28 items-center gap-2">
              <BudgetBar spent={r.finance.spent} budget={r.budget} />
              <span className={cn("tabular w-12 shrink-0 text-right text-xs", BUDGET_TEXT_CLASS[tone])}>{r.outlook.utilisation === null ? "-" : formatPercent(r.outlook.utilisation)}</span>
            </div>
          );
        },
      },
      ...(overrun
        ? [
            {
              id: "overrun",
              accessorFn: (r: ProjectFinanceRow) => r.outlook.overrun,
              meta: { label: "Overrun", align: "right" as const },
              header: ({ column }) => <DataTableColumnHeader column={column} title="Overrun" align="right" />,
              cell: ({ row }) => (row.original.outlook.overrun > 0 ? <Money value={row.original.outlook.overrun} className="font-medium text-danger" /> : <span className="text-muted-foreground">None</span>),
            } satisfies ColumnDef<ProjectFinanceRow>,
          ]
        : []),
      {
        id: "savings",
        accessorFn: (r) => r.outlook.potentialSavings ?? -1,
        meta: { label: "Savings", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Savings" align="right" />,
        cell: ({ row }) => {
          const s = row.original.outlook.potentialSavings;
          if (s === null) return <span className="text-xs text-muted-foreground">{row.original.outlook.closed ? "No budget" : "When closed"}</span>;
          return <Money value={s} className={s > 0 ? "text-success" : undefined} />;
        },
      },
    ],
    [revised, overrun],
  );
  return (
    <DataTable
      id="project-budgets"
      columns={columns}
      data={rows}
      hideToolbar
      pageSize={25}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/finance/projects/${r.id}?tab=budget`)}
      renderMobileRow={(p) => (
        <div className="min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{p.code}</p>
            </div>
            <ProjectStatusBadge status={p.status} />
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="tabular min-w-0 truncate">
              <Money value={p.finance.spent} compact className="font-semibold" />
              <span className="text-muted-foreground"> of </span>
              <Money value={p.budget} compact className="text-muted-foreground" />
            </span>
            <span className={cn("tabular shrink-0 text-xs font-medium", BUDGET_TEXT_CLASS[budgetTone(p.usage, p.budget)])}>
              {p.outlook.utilisation === null ? "No budget" : formatPercent(p.outlook.utilisation)}
            </span>
          </div>
          <BudgetBar spent={p.finance.spent} budget={p.budget} />
          <p className="text-xs text-muted-foreground">
            Original <Money value={p.originalBudget} compact />
            {p.outlook.overrun > 0 ? (
              <span className="text-danger">
                {" "}
                · <Money value={p.outlook.overrun} compact /> over
              </span>
            ) : null}
          </p>
        </div>
      )}
    />
  );
}

/** Stage budgets against stage spend, for projects that set them. */
export function StageBudgetTable({ rows }: { rows: StageBudgetRow[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<StageBudgetRow>[]>(
    () => [
      {
        id: "project",
        accessorKey: "projectName",
        meta: { label: "Project" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <ProjectLink id={row.original.projectId} name={row.original.projectName} code={row.original.projectCode} color={row.original.color} />,
        enableHiding: false,
      },
      { id: "stage", accessorKey: "stageLabel", meta: { label: "Stage" }, header: ({ column }) => <DataTableColumnHeader column={column} title="Stage" /> },
      {
        id: "planned",
        accessorKey: "planned",
        meta: { label: "Stage budget", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Stage budget" align="right" />,
        cell: ({ row }) => <Money value={row.original.planned} />,
      },
      {
        id: "spent",
        accessorKey: "spent",
        meta: { label: "Stage spend", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Stage spend" align="right" />,
        cell: ({ row }) => <Money value={row.original.spent} className="font-medium" />,
      },
      {
        id: "variance",
        accessorKey: "variance",
        meta: { label: "Variance", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Variance" align="right" />,
        cell: ({ row }) => (
          <span className={cn("tabular whitespace-nowrap", row.original.variance < 0 ? "text-danger" : "text-success")}>
            {row.original.variance < 0 ? "Over by " : "Under by "}
            <Money value={Math.abs(row.original.variance)} />
          </span>
        ),
      },
    ],
    [],
  );
  return (
    <DataTable
      id="project-stage-budgets"
      columns={columns}
      data={rows}
      hideToolbar
      pageSize={25}
      getRowId={(r) => r.key}
      onRowClick={(r) => router.push(`/finance/projects/${r.projectId}?tab=budget`)}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-medium">
              {r.projectName} <span className="font-normal text-muted-foreground">· {r.stageLabel}</span>
            </p>
            <Money value={r.spent} className="shrink-0 font-semibold" />
          </div>
          <p className="text-xs text-muted-foreground">
            Stage budget <Money value={r.planned} />
            <span className={r.variance < 0 ? "text-danger" : "text-success"}>
              {" · "}
              {r.variance < 0 ? "over by " : "under by "}
              <Money value={Math.abs(r.variance)} />
            </span>
          </p>
        </div>
      )}
    />
  );
}
