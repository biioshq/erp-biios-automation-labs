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
import { SPEND_TYPES } from "../finance";
import type { ProjectFinanceRow } from "../types";

function ProjectCell({ p }: { p: ProjectFinanceRow }) {
  return (
    <Link href={`/finance/projects/${p.id}`} className="flex min-w-44 items-center gap-3" onClick={(e) => e.stopPropagation()}>
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-medium hover:underline">{p.name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
      </span>
    </Link>
  );
}

const money = (id: string, title: string, pick: (r: ProjectFinanceRow) => number, opts: { tone?: boolean; strong?: boolean } = {}): ColumnDef<ProjectFinanceRow> => ({
  id,
  accessorFn: pick,
  meta: { label: title, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => <Money value={pick(row.original)} tone={opts.tone ? "auto" : undefined} className={opts.strong ? "font-medium" : undefined} />,
});

/** Profit and forecast per project, sortable by every column. */
export function ProfitabilityTable({ rows }: { rows: ProjectFinanceRow[] }) {
  const router = useRouter();
  // Without a contract value, a project's value is its revenue so far, so a Revenue column would
  // only repeat Project value. It is left out then, which also helps the table fit its card.
  const anyContract = rows.some((r) => r.outlook.valueBasis === "contract");
  const columns = useMemo<ColumnDef<ProjectFinanceRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Project" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <ProjectCell p={row.original} />,
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
      {
        id: "value",
        accessorFn: (r) => r.outlook.projectValue,
        meta: { label: "Project value", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project value" align="right" />,
        cell: ({ row }) => (
          <div className="text-right">
            <Money value={row.original.outlook.projectValue} />
            <p className="text-[11px] text-muted-foreground">{row.original.outlook.valueBasis === "contract" ? "Contract" : "Revenue so far"}</p>
          </div>
        ),
      },
      ...(anyContract ? [money("revenue", "Revenue", (r) => r.finance.revenue.revenue)] : []),
      money("received", "Received", (r) => r.finance.revenue.received),
      money("spent", "Spent", (r) => r.finance.spent, { strong: true }),
      money("remaining", "Est. remaining", (r) => r.outlook.estimatedRemaining),
      money("finalCost", "Est. final cost", (r) => r.outlook.expectedFinalCost),
      money("profit", "Est. profit or loss", (r) => r.outlook.estimatedProfit, { tone: true, strong: true }),
      {
        id: "margin",
        accessorFn: (r) => r.outlook.margin ?? -Infinity,
        meta: { label: "Margin", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Margin" align="right" />,
        cell: ({ row }) => {
          const m = row.original.outlook.margin;
          return m === null ? <span className="text-muted-foreground">-</span> : <span className={cn("tabular", m < 0 && "text-danger")}>{formatPercent(m)}</span>;
        },
      },
      {
        id: "variance",
        accessorFn: (r) => (r.budget > 0 ? r.outlook.remainingBudget : -Infinity),
        meta: { label: "Budget variance", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Budget variance" align="right" />,
        cell: ({ row }) => (row.original.budget > 0 ? <Money value={row.original.outlook.remainingBudget} tone="auto" /> : <span className="text-muted-foreground">No budget</span>),
      },
    ],
    [anyContract],
  );
  return (
    <DataTable
      id="project-profitability"
      columns={columns}
      data={rows}
      hideToolbar
      pageSize={25}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/finance/projects/${r.id}`)}
      // Hidden at first so the estimated profit and margin fit the card; "Show all" brings them back.
      initialHidden={["received", "remaining", "variance"]}
      renderMobileRow={(p) => (
        <div className="min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{p.code}</p>
            </div>
            <ProjectStatusBadge status={p.status} />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">{p.outlook.valueBasis === "contract" ? "Project value" : "Revenue so far"}</dt>
            <dd className="text-right">
              <Money value={p.outlook.projectValue} />
            </dd>
            <dt className="text-muted-foreground">Expected final cost</dt>
            <dd className="text-right">
              <Money value={p.outlook.expectedFinalCost} />
            </dd>
            <dt className="text-muted-foreground">Est. profit or loss</dt>
            <dd className="text-right font-medium">
              <Money value={p.outlook.estimatedProfit} tone="auto" />
              {p.outlook.margin !== null ? <span className="font-normal text-muted-foreground"> · {formatPercent(p.outlook.margin)}</span> : null}
            </dd>
          </dl>
        </div>
      )}
    />
  );
}

/** Spend per project split into materials, labour, equipment, transportation and other. */
export function SpendByTypeTable({ rows }: { rows: ProjectFinanceRow[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<ProjectFinanceRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Project" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <ProjectCell p={row.original} />,
        enableHiding: false,
      },
      ...SPEND_TYPES.map((t) => money(t.key, t.label, (r) => r.finance.byType[t.key])),
      money("total", "Total expenditure", (r) => r.finance.spent, { strong: true }),
    ],
    [],
  );
  return (
    <DataTable
      id="project-spend-types"
      columns={columns}
      data={rows}
      hideToolbar
      pageSize={25}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/finance/projects/${r.id}?tab=expenses`)}
      renderMobileRow={(p) => (
        <div className="min-w-0 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-medium">{p.name}</p>
            <Money value={p.finance.spent} className="shrink-0 font-semibold" />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {SPEND_TYPES.map((t) => (
              <div key={t.key} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t.label}</dt>
                <dd>
                  <Money value={p.finance.byType[t.key]} compact />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    />
  );
}
