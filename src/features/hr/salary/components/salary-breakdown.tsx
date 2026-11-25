"use client";

import { SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormSheet, FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AttendanceBadge } from "../../components/attendance-badge";
import { SALARY_BASES, WEEKDAYS, type HrRules } from "../../constants";
import { formatMinutes, weekdayOf, type SalaryDay } from "../calc";
import { monthLabel, type SalaryRow } from "../types";

const DIVISOR: Record<HrRules["salaryBasis"], string> = {
  calendar_days: "days in the month",
  fixed_30: "30",
  working_days: "working days in the month",
};

function DayStatus({ day }: { day: SalaryDay }) {
  if (day.status === "not_employed") return <span className="text-xs text-muted-foreground">Not employed</span>;
  if (day.status === "upcoming")
    return (
      <StatusBadge tone="neutral" dot={false} className="border-dashed">
        Still to come
      </StatusBadge>
    );
  if (day.status === "unmarked") return <AttendanceBadge status={null} />;
  return <AttendanceBadge status={day.status} leaveType={day.leaveType} />;
}

function dayLabel(date: string): string {
  return `${WEEKDAYS[weekdayOf(date)].short} ${Number(date.slice(8, 10))}`;
}

function kindLabel(day: SalaryDay): string {
  if (day.kind === "holiday") return day.holidayName ? `Holiday: ${day.holidayName}` : "Holiday";
  if (day.kind === "week_off") return "Weekly off";
  return "Working day";
}

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("tabular text-sm font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
    </div>
  );
}

/** One person's month: the formula with their numbers, leave by type and every day. */
export function SalaryBreakdown({
  row,
  rules,
  withSalary,
  canAdjust,
  open,
  onOpenChange,
  onAdjust,
}: {
  row: SalaryRow;
  rules: HrRules;
  withSalary: boolean;
  canAdjust: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdjust: () => void;
}) {
  const d = row.days;
  const hours = round2(row.overtimeMinutes / 60);
  const hourly = row.baseDays > 0 && rules.fullDayHours > 0 ? row.monthlySalary / row.baseDays / rules.fullDayHours : 0;
  const basis = SALARY_BASES.find((b) => b.value === row.basis);
  const halfUnpaid = row.breakdown.filter((x) => x.status === "half_day" && !x.leaveType).reduce((sum, x) => sum + x.unpaid, 0);
  const lopParts = [
    d.absent ? `${formatNumber(d.absent)} absent` : null,
    d.leaveUnpaid ? `${formatNumber(d.leaveUnpaid)} unpaid leave` : null,
    halfUnpaid ? `${formatNumber(halfUnpaid)} from half days` : null,
    d.lateDeduction ? `${formatNumber(d.lateDeduction)} for ${formatNumber(d.late)} late arrivals` : null,
    d.unmarked && rules.unmarkedDays === "unpaid" ? `${formatNumber(d.unmarked)} not marked` : null,
  ].filter(Boolean);

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={row.name}
      description={`${[row.code, row.designation].filter(Boolean).join(" · ")}${row.code || row.designation ? " · " : ""}${monthLabel(row.month)}`}
    >
      <FormSheetBody>
        <div className="space-y-6">
          {row.warnings.length ? (
            <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-sm">
              {row.warnings.map((w) => (
                <p key={w} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">How the salary is worked out</h3>
            <p className="text-sm text-muted-foreground">
              {basis?.label ?? "Salary basis"}: monthly salary × payable days ÷ {DIVISOR[row.basis]}.
            </p>
            {withSalary ? (
              <div className="space-y-1.5 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                <p className="tabular">
                  {formatCurrency(row.monthlySalary)} × {formatNumber(d.payable)} ÷ {formatNumber(row.baseDays)} ={" "}
                  <span className="font-semibold">{formatCurrency(row.earned)}</span>
                </p>
                {row.overtimePay > 0 ? (
                  <p className="tabular">
                    Overtime: {formatNumber(hours)} h × {formatCurrency(hourly, { exact: true })} an hour × {formatNumber(rules.overtimeRate)} ={" "}
                    <span className="font-semibold">{formatCurrency(row.overtimePay)}</span>
                  </p>
                ) : null}
                <p className="tabular">
                  Net: {formatCurrency(row.earned)}
                  {row.overtimePay ? ` + ${formatCurrency(row.overtimePay)} overtime` : ""}
                  {row.additions ? ` + ${formatCurrency(row.additions)} bonus` : ""}
                  {row.deductions ? ` − ${formatCurrency(row.deductions)} deductions` : ""} = <span className="font-semibold">{formatCurrency(row.net)}</span>
                </p>
                {row.adjustmentNote ? <p className="text-xs text-muted-foreground">Note: {row.adjustmentNote}</p> : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Amounts are hidden: your role does not include individual salaries.</p>
            )}
            <p className="text-sm text-muted-foreground">
              Payable days: {formatNumber(d.payable)} of {formatNumber(row.baseDays)}. Loss of pay: {formatNumber(d.lop)}{" "}
              {d.lop === 1 ? "day" : "days"}
              {lopParts.length ? ` (${lopParts.join(", ")})` : ""}.
              {d.employed < d.inMonth ? ` Employed on ${formatNumber(d.employed)} of ${formatNumber(d.inMonth)} days this month.` : ""}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Working days" value={formatNumber(d.working)} />
            <Fact label="Present" value={formatNumber(d.present)} />
            <Fact label="Half days" value={formatNumber(d.halfDays)} />
            <Fact label="Absent" value={formatNumber(d.absent)} tone={d.absent ? "danger" : undefined} />
            <Fact label="Paid leave" value={formatNumber(d.leavePaid)} />
            <Fact label="Unpaid leave" value={formatNumber(d.leaveUnpaid)} tone={d.leaveUnpaid ? "danger" : undefined} />
            <Fact label="Late arrivals" value={formatNumber(d.late)} tone={d.late ? "warning" : undefined} />
            <Fact label="Overtime" value={formatMinutes(row.overtimeMinutes) || "None"} />
            <Fact label="Not marked" value={formatNumber(d.unmarked)} tone={d.unmarked ? "warning" : undefined} />
            <Fact label="Still to come" value={formatNumber(d.upcoming)} />
            <Fact label="Weekly offs" value={formatNumber(d.weekOffs)} />
            <Fact label="Holidays" value={formatNumber(d.holidays)} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Leave by type</h3>
            {row.leaveByType.length ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Leave type</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Unpaid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {row.leaveByType.map((l) => (
                      <TableRow key={l.code}>
                        <TableCell>
                          {l.name} <span className="text-xs text-muted-foreground">{l.code}</span>
                        </TableCell>
                        <TableCell className="tabular text-right">{formatNumber(l.days)}</TableCell>
                        <TableCell className="tabular text-right">{formatNumber(l.paidDays)}</TableCell>
                        <TableCell className={cn("tabular text-right", l.days - l.paidDays > 0 && "text-danger")}>{formatNumber(round2(l.days - l.paidDays))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No leave this month.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Day by day</h3>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {row.breakdown.map((day) => (
                    <TableRow key={day.date} className={cn(day.kind !== "working" && "bg-muted/30", day.status === "not_employed" && "text-muted-foreground")}>
                      <TableCell className="tabular font-medium">{dayLabel(day.date)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{kindLabel(day)}</TableCell>
                      <TableCell>
                        <DayStatus day={day} />
                      </TableCell>
                      <TableCell className="tabular">{day.inTime ?? ""}</TableCell>
                      <TableCell className="tabular">{day.outTime ?? ""}</TableCell>
                      <TableCell className="tabular text-right">
                        {formatMinutes(day.workedMinutes)}
                        {day.overtimeMinutes ? <span className="block text-xs text-muted-foreground">{formatMinutes(day.overtimeMinutes)} overtime</span> : null}
                      </TableCell>
                      <TableCell>{day.late ? <StatusBadge tone="warning">Late</StatusBadge> : null}</TableCell>
                      <TableCell className={cn("tabular text-right", day.unpaid > 0 && "text-danger")}>
                        {day.status === "not_employed" ? "" : formatNumber(day.paid)}
                      </TableCell>
                      <TableCell className="min-w-48 text-xs whitespace-normal text-muted-foreground">{day.note ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        {canAdjust ? (
          <Button type="button" onClick={onAdjust}>
            <SlidersHorizontal /> Adjust
          </Button>
        ) : null}
      </FormSheetFooter>
    </FormSheet>
  );
}
