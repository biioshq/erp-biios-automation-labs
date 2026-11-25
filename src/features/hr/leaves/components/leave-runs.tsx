"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CalendarOff, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { emitDataChanged } from "@/lib/events";
import { deleteLeave } from "../actions";
import type { LeaveRun } from "../types";
import { dayLabel, daysLabel, LeaveTypeBadge } from "./leave-bits";

function DateSpan({ run }: { run: LeaveRun }) {
  return run.from === run.to ? <span>{dayLabel(run.from)}</span> : <span>{`${dayLabel(run.from)} to ${dayLabel(run.to)}`}</span>;
}

/** The leave records of a leave year, newest first, with delete when the role allows it. */
export function LeaveRuns({
  runs,
  canDelete,
  canCreate,
  recordHref,
  filtered,
  yearLabel,
}: {
  runs: LeaveRun[];
  canDelete: boolean;
  canCreate: boolean;
  /** Opens the record leave panel, keeping the leave year and employee filter. */
  recordHref: string;
  /** An employee filter is on. */
  filtered: boolean;
  yearLabel: string;
}) {
  const [rows, removeRow] = useOptimistic(runs, (state, key: string) => state.filter((r) => r.key !== key));
  const [deleting, setDeleting] = useState<LeaveRun | null>(null);

  async function remove(run: LeaveRun) {
    startTransition(() => removeRow(run.key));
    const result = await deleteLeave({ ids: run.ids });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${run.employeeName}: ${daysLabel(run.days).toLowerCase()} of ${run.typeName.toLowerCase()} deleted`);
    emitDataChanged();
    return true;
  }

  const deleteButton = (run: LeaveRun) =>
    run.locked ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" tabIndex={0} className="inline-flex size-10 items-center justify-center text-muted-foreground sm:size-8" aria-label="Locked: the salary for this month is finalised">
            <Lock className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>The salary for this month is finalised. Reopen it on the Salary tab to change this leave.</TooltipContent>
      </Tooltip>
    ) : (
      <Button
        variant="ghost"
        size="icon"
        className="size-10 text-muted-foreground hover:text-danger sm:size-8"
        aria-label={`Delete leave of ${run.employeeName} from ${dayLabel(run.from)}`}
        onClick={(e) => {
          e.stopPropagation();
          setDeleting(run);
        }}
      >
        <Trash2 />
      </Button>
    );

  const columns = useMemo<ColumnDef<LeaveRun>[]>(
    () => [
      {
        id: "employeeName",
        accessorKey: "employeeName",
        meta: { label: "Employee" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Employee" />,
        cell: ({ row }) => (
          <div className="min-w-40">
            <p className="truncate font-medium">{row.original.employeeName}</p>
            {row.original.employeeCode ? <p className="font-mono text-[11px] text-muted-foreground">{row.original.employeeCode}</p> : null}
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "leaveType",
        accessorKey: "leaveType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <div className="flex min-w-32 flex-col items-start gap-1">
            <LeaveTypeBadge code={row.original.leaveType} name={row.original.typeName} paid={row.original.paid} />
            <span className="text-xs text-muted-foreground">{row.original.typeName}</span>
          </div>
        ),
      },
      {
        id: "from",
        accessorKey: "from",
        meta: { label: "From" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="From" />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{dayLabel(row.original.from)}</span>,
      },
      {
        id: "to",
        accessorKey: "to",
        meta: { label: "To" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="To" />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{dayLabel(row.original.to)}</span>,
      },
      {
        id: "days",
        accessorKey: "days",
        meta: { label: "Days", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Days" align="right" />,
        cell: ({ row }) => <span className="tabular font-medium whitespace-nowrap">{daysLabel(row.original.days)}</span>,
      },
      {
        id: "reason",
        accessorKey: "reason",
        meta: { label: "Reason" },
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.reason ? (
            <p className="line-clamp-2 max-w-72 min-w-40 text-sm text-pretty text-muted-foreground">{row.original.reason}</p>
          ) : (
            <span className="text-xs text-muted-foreground/70">No reason given</span>
          ),
      },
      ...(canDelete
        ? ([
            {
              id: "actions",
              meta: { align: "right", className: "w-12" },
              header: () => <span className="sr-only">Delete</span>,
              enableHiding: false,
              enableSorting: false,
              cell: ({ row }) => <div className="flex justify-end">{deleteButton(row.original)}</div>,
            },
          ] satisfies ColumnDef<LeaveRun>[])
        : []),
    ],
    [canDelete],
  );

  if (!runs.length) {
    return (
      <EmptyState
        icon={CalendarOff}
        title={filtered ? "No leave for this person" : "No leave recorded"}
        description={
          filtered
            ? `Nothing recorded for this person in leave year ${yearLabel}.`
            : `Leave recorded here, or marked as leave on the daily sheet, shows up for leave year ${yearLabel}.`
        }
        action={
          canCreate ? (
            <Button asChild>
              <Link href={recordHref} scroll={false}>
                <Plus /> Record leave
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <DataTable
        id="hr-leaves"
        columns={columns}
        data={rows}
        hideToolbar
        pageSize={20}
        getRowId={(r) => r.key}
        renderMobileRow={(r) => (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.employeeName}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    <DateSpan run={r} />
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm font-medium">{daysLabel(r.days)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <LeaveTypeBadge code={r.leaveType} name={r.typeName} paid={r.paid} />
                <span className="text-xs text-muted-foreground">{r.typeName}</span>
              </div>
              {r.reason ? <p className="line-clamp-2 text-xs text-pretty text-muted-foreground [overflow-wrap:anywhere]">{r.reason}</p> : null}
            </div>
            {canDelete ? <div className="-mt-1 -mr-1.5 shrink-0">{deleteButton(r)}</div> : null}
          </div>
        )}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this leave?"
        description={
          deleting
            ? `${deleting.employeeName}, ${deleting.typeName.toLowerCase()}, ${deleting.from === deleting.to ? dayLabel(deleting.from) : `${dayLabel(deleting.from)} to ${dayLabel(deleting.to)}`} (${daysLabel(deleting.days).toLowerCase()}). ${deleting.marks === 1 ? "That day goes" : "Those days go"} back to not marked, and the salary for those months is worked out again.`
            : undefined
        }
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
