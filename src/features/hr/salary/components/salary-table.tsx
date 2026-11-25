"use client";

import { useState } from "react";
import { SlidersHorizontal, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/shared/empty-state";
import { LimitedTable } from "@/components/shared/limited-table";
import { Money } from "@/components/shared/money";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HrRules } from "../../constants";
import { formatMinutes } from "../calc";
import type { SalaryRow, SalaryTotals } from "../types";
import { AdjustmentDialog } from "./adjustment-dialog";
import { SalaryBreakdown } from "./salary-breakdown";

const num = "tabular text-right";
const sticky = "sticky left-0 z-10 bg-card";

/** What Expenses hold against the net worked out here. */
function BookedCell({ booked, net }: { booked: number; net: number }) {
  const diff = round2(booked - net);
  return (
    <div className="flex flex-col items-end">
      <Money value={booked} />
      <span className="text-[11px] text-muted-foreground">
        {booked === 0 ? "Nothing booked" : Math.abs(diff) < 1 ? "Matches net" : `${formatCurrency(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than net`}
      </span>
    </div>
  );
}

function Warnings({ warnings, name, onOpen }: { warnings: string[]; name: string; onOpen: () => void }) {
  if (!warnings.length) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-warning"
          aria-label={`${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"} for ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <TriangleAlert />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-1">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The salary lines of a month. Clicking a person opens their breakdown. Amount columns render
 * only with `withSalary`; the server leaves the amounts out otherwise.
 */
export function SalaryTable({
  rows,
  totals,
  bookedTotal,
  rules,
  withSalary,
  canAdjust,
}: {
  rows: SalaryRow[];
  totals: SalaryTotals;
  bookedTotal: number | null;
  rules: HrRules;
  withSalary: boolean;
  /** Approve and salaries, and the month is not finalised. */
  canAdjust: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const open = rows.find((r) => r.employeeId === openId) ?? null;
  const adjusting = rows.find((r) => r.employeeId === adjustId) ?? null;

  if (!rows.length) {
    return <EmptyState className="m-4 sm:m-5" icon={Users} title="Nobody to pay this month" description="No employee was employed in this month. People are added on the Employees page." />;
  }

  const payableTotal = round2(rows.reduce((s, r) => s + r.days.payable, 0));
  const leavePaid = round2(rows.reduce((s, r) => s + r.days.leavePaid, 0));
  const leaveUnpaid = round2(rows.reduce((s, r) => s + r.days.leaveUnpaid, 0));
  const late = rows.reduce((s, r) => s + r.days.late, 0);

  const header = (
    <TableHeader>
      <TableRow>
        <TableHead className={cn(sticky, "min-w-44")}>Employee</TableHead>
        {withSalary ? <TableHead className="text-right">Monthly salary</TableHead> : null}
        <TableHead className="text-right">Payable days</TableHead>
        <TableHead className="text-right">LOP days</TableHead>
        {withSalary ? (
          <>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right">Booked in Expenses</TableHead>
            <TableHead className="text-right">Earned</TableHead>
            <TableHead className="text-right">Overtime pay</TableHead>
            <TableHead className="text-right">Bonus</TableHead>
            <TableHead className="text-right">Deductions</TableHead>
          </>
        ) : null}
        <TableHead className="text-right">
          Leave <span className="font-normal text-muted-foreground">paid / unpaid</span>
        </TableHead>
        <TableHead className="text-right">Late</TableHead>
        <TableHead className="text-right">Overtime</TableHead>
        <TableHead>
          <span className="sr-only">Warnings</span>
        </TableHead>
        {canAdjust ? (
          <TableHead>
            <span className="sr-only">Adjust</span>
          </TableHead>
        ) : null}
      </TableRow>
    </TableHeader>
  );

  const body = rows.map((r) => {
    const d = r.days;
    return (
      <TableRow key={r.employeeId} className="group cursor-pointer" onClick={() => setOpenId(r.employeeId)}>
        <TableCell className={cn(sticky, "max-w-56 group-hover:bg-muted")}>
          <button
            type="button"
            className="block max-w-full truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              setOpenId(r.employeeId);
            }}
          >
            {r.name}
          </button>
          <span className="block truncate text-xs text-muted-foreground">{[r.code, r.designation].filter(Boolean).join(" · ")}</span>
        </TableCell>
        {withSalary ? (
          <TableCell className={num}>
            <Money value={r.monthlySalary} />
          </TableCell>
        ) : null}
        <TableCell className={num}>
          {formatNumber(d.payable)} <span className="text-muted-foreground">of {formatNumber(r.baseDays)}</span>
        </TableCell>
        <TableCell className={cn(num, d.lop > 0 ? "text-danger" : "text-muted-foreground")}>{formatNumber(d.lop)}</TableCell>
        {withSalary ? (
          <>
            <TableCell className={cn(num, "font-semibold")}>
              <Money value={r.net} />
            </TableCell>
            <TableCell className={num}>{r.booked !== null ? <BookedCell booked={r.booked} net={r.net} /> : null}</TableCell>
            <TableCell className={num}>
              <Money value={r.earned} />
            </TableCell>
            <TableCell className={cn(num, !r.overtimePay && "text-muted-foreground")}>
              <Money value={r.overtimePay} />
            </TableCell>
            <TableCell className={cn(num, !r.additions && "text-muted-foreground")}>
              <Money value={r.additions} />
            </TableCell>
            <TableCell className={cn(num, !r.deductions && "text-muted-foreground")}>
              <Money value={r.deductions} />
            </TableCell>
          </>
        ) : null}
        <TableCell className={num}>
          {d.leavePaid || d.leaveUnpaid ? (
            <>
              {formatNumber(d.leavePaid)} / <span className={cn(d.leaveUnpaid > 0 && "text-danger")}>{formatNumber(d.leaveUnpaid)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </TableCell>
        <TableCell className={num}>
          <span className={cn(d.late ? "text-warning" : "text-muted-foreground")}>{formatNumber(d.late)}</span>
          {d.lateDeduction ? <span className="block text-[11px] text-muted-foreground">{formatNumber(d.lateDeduction)} day cut</span> : null}
        </TableCell>
        <TableCell className={cn(num, !r.overtimeMinutes && "text-muted-foreground")}>{formatMinutes(r.overtimeMinutes) || "0"}</TableCell>
        <TableCell className="w-10">
          <Warnings warnings={r.warnings} name={r.name} onOpen={() => setOpenId(r.employeeId)} />
        </TableCell>
        {canAdjust ? (
          <TableCell className="w-10">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Adjust salary for ${r.name}`}
              title="Bonus and deductions"
              onClick={(e) => {
                e.stopPropagation();
                setAdjustId(r.employeeId);
              }}
            >
              <SlidersHorizontal />
            </Button>
          </TableCell>
        ) : null}
      </TableRow>
    );
  });

  const footer = (
    <TableFooter>
      <TableRow className="hover:bg-transparent">
        <TableCell className={cn(sticky, "bg-muted font-semibold")}>
          Total, {formatNumber(totals.people)} {totals.people === 1 ? "person" : "people"}
        </TableCell>
        {withSalary ? (
          <TableCell className={num}>
            <Money value={totals.monthlySalary} />
          </TableCell>
        ) : null}
        <TableCell className={num}>{formatNumber(payableTotal)}</TableCell>
        <TableCell className={num}>{formatNumber(totals.lopDays)}</TableCell>
        {withSalary ? (
          <>
            <TableCell className={num}>
              <Money value={totals.net} />
            </TableCell>
            <TableCell className={num}>{bookedTotal !== null ? <Money value={bookedTotal} /> : null}</TableCell>
            <TableCell className={num}>
              <Money value={totals.earned} />
            </TableCell>
            <TableCell className={num}>
              <Money value={totals.overtimePay} />
            </TableCell>
            <TableCell className={num}>
              <Money value={totals.additions} />
            </TableCell>
            <TableCell className={num}>
              <Money value={totals.deductions} />
            </TableCell>
          </>
        ) : null}
        <TableCell className={num}>
          {formatNumber(leavePaid)} / {formatNumber(leaveUnpaid)}
        </TableCell>
        <TableCell className={num}>{formatNumber(late)}</TableCell>
        <TableCell className={num}>{formatMinutes(totals.overtimeMinutes) || "0"}</TableCell>
        <TableCell />
        {canAdjust ? <TableCell /> : null}
      </TableRow>
    </TableFooter>
  );

  return (
    <>
      <LimitedTable header={header} rows={body} footer={footer} initialRows={25} />
      {open ? (
        <SalaryBreakdown
          key={open.employeeId}
          row={open}
          rules={rules}
          withSalary={withSalary}
          canAdjust={canAdjust}
          open
          onOpenChange={(o) => !o && setOpenId(null)}
          onAdjust={() => {
            setOpenId(null);
            setAdjustId(open.employeeId);
          }}
        />
      ) : null}
      {adjusting ? <AdjustmentDialog key={`${adjusting.employeeId}-${adjusting.additions}-${adjusting.deductions}`} row={adjusting} open onOpenChange={(o) => !o && setAdjustId(null)} /> : null}
    </>
  );
}
