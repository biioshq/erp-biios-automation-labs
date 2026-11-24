"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectForecastRow } from "../types";
import { ProjectLink } from "./status";
import { VarianceText, methodText } from "./variance";

const moneyCol = (id: string, title: string, pick: (r: ProjectForecastRow) => number, className?: string): ColumnDef<ProjectForecastRow> => ({
  id,
  accessorFn: pick,
  meta: { label: title, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => <Money value={pick(row.original)} className={className} />,
});

/** Open projects with their spend, the run-rate estimate and the predicted total (the shared project forecast rule). */
export function ProjectForecastTable({ rows }: { rows: ProjectForecastRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const columns = useMemo<ColumnDef<ProjectForecastRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Project" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => <ProjectLink {...row.original} href={`/finance/projects/${row.original.id}?tab=budget`} />,
        enableHiding: false,
      },
      { id: "status", accessorKey: "status", meta: { label: "Status" }, header: "Status", enableSorting: false, cell: ({ row }) => <ProjectStatusBadge status={row.original.status} /> },
      moneyCol("originalBudget", "Original budget", (r) => r.originalBudget, "text-muted-foreground"),
      moneyCol("budget", "Budget", (r) => r.budget),
      moneyCol("spent", "Spent to date", (r) => r.spent, "font-medium"),
      {
        id: "used",
        accessorFn: (r) => r.usedShare ?? -1,
        meta: { label: "Budget used", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Budget used" align="right" />,
        cell: ({ row }) => {
          const u = row.original.usedShare;
          return u === null ? <span className="text-xs text-muted-foreground">No budget</span> : <span className={cn("tabular", u > 1 && "text-danger")}>{formatPercent(u)}</span>;
        },
      },
      {
        id: "runRate",
        accessorFn: (r) => r.runRateRemaining ?? -1,
        meta: { label: "Remaining at run rate", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Remaining at run rate" align="right" />,
        cell: ({ row }) =>
          row.original.runRateRemaining === null ? (
            <span className="block max-w-44 text-right text-xs text-muted-foreground">{row.original.runRateNote}</span>
          ) : (
            <Money value={row.original.runRateRemaining} />
          ),
      },
      moneyCol("budgetRemaining", "Budget left", (r) => r.budgetRemaining, "text-muted-foreground"),
      {
        id: "predicted",
        accessorFn: (r) => r.predictedTotal ?? -1,
        meta: { label: "Predicted total cost", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Predicted total cost" align="right" />,
        cell: ({ row }) =>
          row.original.predictedTotal === null ? (
            <span className="block max-w-44 text-right text-xs text-muted-foreground">{row.original.forecastNote}</span>
          ) : (
            <div className="flex flex-col items-end gap-0.5" title={row.original.forecastNote}>
              <Money value={row.original.predictedTotal} className="font-semibold" />
              <span className="text-right text-[11px] text-muted-foreground">{methodText(row.original)}</span>
            </div>
          ),
      },
      {
        id: "variance",
        accessorFn: (r) => r.variance ?? Number.NEGATIVE_INFINITY,
        meta: { label: "Expected overrun or saving", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expected overrun or saving" align="right" />,
        cell: ({ row }) => <VarianceText row={row.original} />,
      },
      {
        id: "categories",
        accessorFn: (r) => r.categories[0]?.label ?? "",
        meta: { label: "Main cost categories" },
        header: "Main cost categories",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.categories.length ? (
            <span className="block min-w-44 text-xs text-muted-foreground">
              {row.original.categories
                .slice(0, 3)
                .map((c) => `${c.label} ${formatPercent(c.share)}`)
                .join(", ")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No spend yet</span>
          ),
      },
    ],
    [],
  );

  function open(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <DataTable
      id="forecast-projects"
      columns={columns}
      data={rows}
      hideToolbar
      pageSize={25}
      getRowId={(r) => r.id}
      onRowClick={(r) => open(r.id)}
      renderMobileRow={(p) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{p.code}</p>
            </div>
            <ProjectStatusBadge status={p.status} />
          </div>
          <p className="tabular text-sm">
            <Money value={p.spent} compact className="font-semibold" /> spent
            {p.method === "run_rate" ? (
              <>
                {" "}
                · predicted <Money value={p.predictedTotal} compact />
              </>
            ) : null}{" "}
            of <Money value={p.budget} compact />
          </p>
          <p className="text-xs">
            <VarianceText row={p} /> <span className="text-muted-foreground">· {p.method === "none" ? p.forecastNote : methodText(p)}</span>
          </p>
        </div>
      )}
    />
  );
}
