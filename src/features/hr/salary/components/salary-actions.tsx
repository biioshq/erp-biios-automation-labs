"use client";

import { Download, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { emitDataChanged } from "@/lib/events";
import { finaliseMonth, reopenMonth } from "../actions";
import { monthLabel } from "../types";

/** Header buttons of the salary page: download, and finalise or reopen the month. */
export function SalaryActions({
  month,
  canExport,
  canApprove,
  finalised,
  monthOver,
  hasLines,
}: {
  month: string;
  canExport: boolean;
  /** "hr.salary:approve" and "data.salaries". */
  canApprove: boolean;
  finalised: boolean;
  /** False for the current month: its days still to come are counted as paid. */
  monthOver: boolean;
  hasLines: boolean;
}) {
  const label = monthLabel(month);
  const exportHref = (format: "xlsx" | "csv") => `/api/hr/salary/export?${new URLSearchParams({ month, format }).toString()}`;

  return (
    <>
      {canExport ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Download className="opacity-70" /> Download
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">Salary for {label}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <a href={exportHref("xlsx")}>Excel (.xlsx)</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={exportHref("csv")}>CSV</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canApprove && finalised ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline">
              <LockOpen /> Reopen month
            </Button>
          }
          title={`Reopen ${label}?`}
          description="Attendance, leave and adjustments for this month can be changed again, and the salary is worked out live from them. The saved lines are replaced when the month is finalised again. Expenses do not change."
          confirmLabel="Reopen month"
          destructive={false}
          onConfirm={async () => {
            const result = await reopenMonth({ month });
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            toast.success(result.message ?? "Month reopened");
            emitDataChanged();
          }}
        />
      ) : null}

      {canApprove && !finalised ? (
        <ConfirmDialog
          trigger={
            <Button disabled={!hasLines}>
              <Lock /> Finalise month
            </Button>
          }
          title={`Finalise ${label}?`}
          description={
            <>
              The salary lines are saved as they are now, and attendance, leave and adjustments for this month are locked until someone reopens it.
              {monthOver ? null : " The month is not over yet: days still to come are counted as paid."} Expenses do not change: salary expenses are still
              posted by each person&apos;s salary schedule in Recurring expenses.
            </>
          }
          confirmLabel="Finalise month"
          destructive={false}
          onConfirm={async () => {
            const result = await finaliseMonth({ month });
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            toast.success(result.message ?? "Month finalised");
            emitDataChanged();
          }}
        />
      ) : null}
    </>
  );
}
