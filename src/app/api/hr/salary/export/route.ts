import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { formatDateTime, round2 } from "@/lib/format";
import { CONTENT_TYPES } from "@/features/reports/server/export";
import { renderCsv } from "@/features/reports/server/render-csv";
import { renderXlsx } from "@/features/reports/server/render-xlsx";
import type { ReportColumn, ReportData, ReportRow, ReportSection, SummaryItem } from "@/features/reports/types";
import { monthInput } from "@/features/hr/schemas";
import { attendanceStatusLabel, type AttendanceStatus } from "@/features/hr/constants";
import { monthOf, todayIST } from "@/features/hr/server";
import { getSalaryMonth } from "@/features/hr/salary/queries";
import { monthLabel, type SalaryMonthData } from "@/features/hr/salary/types";
import type { SalaryDay } from "@/features/hr/salary/calc";

// ExcelJS needs Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const col = (key: string, header: string, type: ReportColumn["type"], width: number): ReportColumn => ({ key, header, type, width });

function dayStatusLabel(day: SalaryDay): string {
  if (day.status === "not_employed") return "Not employed";
  if (day.status === "upcoming") return "Still to come";
  if (day.status === "unmarked") return "Not marked";
  return attendanceStatusLabel(day.status as AttendanceStatus);
}

function dayKindLabel(day: SalaryDay): string {
  if (day.kind === "holiday") return day.holidayName ? `Holiday: ${day.holidayName}` : "Holiday";
  return day.kind === "week_off" ? "Weekly off" : "Working day";
}

/** The page's lines as a report: one table of people, one of their days. Amounts only with `withSalary`. */
function toReport(data: SalaryMonthData, monthOver: boolean): Omit<ReportData, "type"> {
  const amounts = data.withSalary;
  const columns: ReportColumn[] = [
    col("name", "Employee", "text", 24),
    col("code", "Code", "text", 10),
    col("designation", "Designation", "text", 18),
    ...(amounts ? [col("monthlySalary", "Monthly salary", "money", 14)] : []),
    col("baseDays", "Base days", "number", 9),
    col("payable", "Payable days", "number", 10),
    col("lop", "LOP days", "number", 9),
    col("present", "Present", "number", 8),
    col("halfDays", "Half days", "number", 8),
    col("absent", "Absent", "number", 8),
    col("leavePaid", "Paid leave", "number", 9),
    col("leaveUnpaid", "Unpaid leave", "number", 9),
    col("unmarked", "Not marked", "number", 9),
    col("late", "Late arrivals", "number", 9),
    col("lateDeduction", "Days cut for late", "number", 10),
    col("overtimeHours", "Overtime hours", "number", 10),
    ...(amounts
      ? [
          col("earned", "Earned", "money", 14),
          col("overtimePay", "Overtime pay", "money", 12),
          col("additions", "Bonus", "money", 12),
          col("deductions", "Deductions", "money", 12),
          col("net", "Net", "money", 14),
          col("booked", "Booked in Expenses", "money", 14),
          col("adjustmentNote", "Adjustment note", "text", 24),
        ]
      : []),
    col("warnings", "Warnings", "text", 40),
  ];

  const rows: ReportRow[] = data.rows.map((r) => ({
    name: r.name,
    code: r.code,
    designation: r.designation ?? "",
    monthlySalary: r.monthlySalary,
    baseDays: r.baseDays,
    payable: r.days.payable,
    lop: r.days.lop,
    present: r.days.present,
    halfDays: r.days.halfDays,
    absent: r.days.absent,
    leavePaid: r.days.leavePaid,
    leaveUnpaid: r.days.leaveUnpaid,
    unmarked: r.days.unmarked,
    late: r.days.late,
    lateDeduction: r.days.lateDeduction,
    overtimeHours: round2(r.overtimeMinutes / 60),
    earned: r.earned,
    overtimePay: r.overtimePay,
    additions: r.additions,
    deductions: r.deductions,
    net: r.net,
    booked: r.booked ?? 0,
    adjustmentNote: r.adjustmentNote ?? "",
    warnings: r.warnings.join(" "),
  }));

  const t = data.totals;
  const sum = (pick: (r: SalaryMonthData["rows"][number]) => number) => round2(data.rows.reduce((s, r) => s + pick(r), 0));
  const totals: ReportRow = {
    name: `Total, ${t.people} ${t.people === 1 ? "person" : "people"}`,
    monthlySalary: t.monthlySalary,
    payable: sum((r) => r.days.payable),
    lop: t.lopDays,
    present: sum((r) => r.days.present),
    halfDays: sum((r) => r.days.halfDays),
    absent: sum((r) => r.days.absent),
    leavePaid: sum((r) => r.days.leavePaid),
    leaveUnpaid: sum((r) => r.days.leaveUnpaid),
    unmarked: t.unmarked,
    late: sum((r) => r.days.late),
    lateDeduction: sum((r) => r.days.lateDeduction),
    overtimeHours: round2(t.overtimeMinutes / 60),
    earned: t.earned,
    overtimePay: t.overtimePay,
    additions: t.additions,
    deductions: t.deductions,
    net: t.net,
    booked: data.bookedTotal ?? 0,
  };

  const daysSection: ReportSection = {
    title: "Day by day",
    columns: [
      col("name", "Employee", "text", 24),
      col("date", "Date", "date", 12),
      col("kind", "Day", "text", 16),
      col("status", "Status", "text", 14),
      col("leaveType", "Leave type", "text", 9),
      col("inTime", "In", "text", 7),
      col("outTime", "Out", "text", 7),
      col("hours", "Hours worked", "number", 9),
      col("overtime", "Overtime hours", "number", 9),
      col("late", "Late", "text", 6),
      col("paid", "Paid share", "number", 8),
      col("note", "Note", "text", 30),
    ],
    rows: data.rows.flatMap((r) =>
      r.breakdown
        .filter((d) => d.status !== "not_employed")
        .map((d) => ({
          name: r.name,
          date: d.date,
          kind: dayKindLabel(d),
          status: dayStatusLabel(d),
          leaveType: d.leaveType ?? "",
          inTime: d.inTime ?? "",
          outTime: d.outTime ?? "",
          hours: round2(d.workedMinutes / 60),
          overtime: round2(d.overtimeMinutes / 60),
          late: d.late ? "Late" : "",
          paid: d.paid,
          note: d.note ?? "",
        })),
    ),
    totals: null,
  };

  const summary: SummaryItem[] = [
    { label: "People", value: t.people, type: "number" },
    { label: "Loss of pay (days)", value: t.lopDays, type: "number" },
    { label: "Days not marked", value: t.unmarked, type: "number" },
    { label: "Overtime hours", value: round2(t.overtimeMinutes / 60), type: "number" },
    ...(amounts
      ? ([
          { label: "Monthly salaries", value: t.monthlySalary, type: "money" },
          { label: "Loss of pay (amount)", value: t.lopAmount, type: "money" },
          { label: "Overtime pay", value: t.overtimePay, type: "money" },
          { label: "Net payable", value: t.net, type: "money" },
        ] satisfies SummaryItem[])
      : []),
  ];

  const status = data.finalised
    ? `Finalised${data.run?.finalisedAt ? ` on ${formatDateTime(data.run.finalisedAt)}` : ""}${data.run?.finalisedByName ? ` by ${data.run.finalisedByName}` : ""}`
    : `Worked out live from attendance; not finalised${monthOver ? "" : ". The month is not over yet: days still to come are counted as paid"}`;
  const main: ReportSection = { title: "Salary from attendance", columns, rows, totals };

  return {
    ...main,
    subtitle: `${monthLabel(data.month)}. ${status}.${amounts ? "" : " Amounts are left out: your role does not include individual salaries."} Expenses are not changed by this sheet.`,
    summary,
    sections: [main, daysSection],
    // The CSV carries the salary lines only; the days are in the Excel file.
    csvPrimaryOnly: true,
  };
}

/** GET /api/hr/salary/export?month=YYYY-MM&format=xlsx|csv */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "hr.salary:export")) return NextResponse.json({ error: "You do not have permission to download this." }, { status: 403 });

  const search = request.nextUrl.searchParams;
  const thisMonth = monthOf(todayIST());
  const rawMonth = search.get("month");
  const parsedMonth = rawMonth ? monthInput.safeParse(rawMonth) : null;
  if (parsedMonth && !parsedMonth.success) return NextResponse.json({ error: "Pick a month as YYYY-MM." }, { status: 400 });
  const month = parsedMonth?.data ?? thisMonth;
  if (month > thisMonth) return NextResponse.json({ error: `${monthLabel(month)} has not started yet.` }, { status: 400 });
  const format = search.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "csv") return NextResponse.json({ error: "Use format xlsx or csv." }, { status: 400 });

  try {
    const data = await getSalaryMonth(month, { withSalary: can(user, "data.salaries") });
    // The renderers do not read the report type, which only names the built-in reports.
    const report = toReport(data, month < thisMonth) as ReportData;
    const body = format === "csv" ? renderCsv(report) : await renderXlsx(report);
    const fileName = `salary-${month}.${format}`;
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Salary export failed", error);
    return NextResponse.json({ error: "The salary sheet could not be generated. Please try again." }, { status: 500 });
  }
}
