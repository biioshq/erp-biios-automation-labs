import { Users } from "lucide-react";
import { TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LimitedTable } from "@/components/shared/limited-table";
import { EmptyState } from "@/components/shared/empty-state";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeaveBalances, LeaveBalanceType } from "../types";

/** "used / allowance" with what is left under it; over the allowance in the danger colour. */
function BalanceCell({ type, used }: { type: LeaveBalanceType; used: number }) {
  if (type.yearlyQuota === null) {
    return <span className={cn("tabular", used ? "font-medium" : "text-muted-foreground/70")}>{formatNumber(used)}</span>;
  }
  const left = type.yearlyQuota - used;
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="tabular whitespace-nowrap">
        <span className={cn(used ? "font-medium" : "text-muted-foreground/70")}>{formatNumber(used)}</span>
        <span className="text-muted-foreground"> / {formatNumber(type.yearlyQuota)}</span>
      </span>
      <span className={cn("tabular text-xs whitespace-nowrap", left < 0 ? "font-medium text-danger" : "text-muted-foreground")}>
        {left < 0 ? `over by ${formatNumber(-left)}` : `${formatNumber(left)} left`}
      </span>
    </div>
  );
}

/** Leave used by each person in the leave year, against each type's yearly allowance. Server-rendered rows. */
export function LeaveBalancesTable({ balances, filtered = false }: { balances: LeaveBalances; filtered?: boolean }) {
  const { types, rows } = balances;
  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon={Users}
        title="Nobody to show"
        description={filtered ? "This person was not employed in this leave year." : "No one was employed in this leave year."}
        className="m-4 sm:m-5"
      />
    );
  }
  if (!types.length) {
    return (
      <EmptyState compact icon={Users} title="No leave types" description="Add leave types on the Rules tab to track balances." className="m-4 sm:m-5" />
    );
  }

  return (
    <LimitedTable
      initialRows={15}
      className="min-w-max"
      header={
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 min-w-40 bg-card pl-4 sm:pl-5">Employee</TableHead>
            {types.map((t) => (
              <TableHead key={t.code} className="text-right whitespace-nowrap">
                <span className="block font-medium">{t.name}</span>
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {t.known ? `${t.paid ? "Paid" : "Unpaid"}, ${t.yearlyQuota === null ? "no limit" : `${formatNumber(t.yearlyQuota)} a year`}` : "Used only"}
                </span>
              </TableHead>
            ))}
            <TableHead className="pr-4 text-right sm:pr-5">Total</TableHead>
          </TableRow>
        </TableHeader>
      }
      rows={rows.map((r) => (
        <TableRow key={r.employeeId}>
          <TableCell className="sticky left-0 z-10 max-w-56 bg-card pl-4 sm:pl-5">
            <p className="truncate font-medium">{r.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono text-[11px]">{r.code}</span>
              {r.designation ? ` · ${r.designation}` : ""}
            </p>
          </TableCell>
          {types.map((t) => (
            <TableCell key={t.code} className="text-right align-middle">
              <BalanceCell type={t} used={r.used[t.code] ?? 0} />
            </TableCell>
          ))}
          <TableCell className="tabular pr-4 text-right font-medium sm:pr-5">{formatNumber(r.total)}</TableCell>
        </TableRow>
      ))}
    />
  );
}
