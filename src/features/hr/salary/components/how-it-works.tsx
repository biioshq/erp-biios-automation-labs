import Link from "next/link";
import { Info } from "lucide-react";
import { Section } from "@/components/shared/page";
import { formatNumber } from "@/lib/format";
import { SALARY_BASES, UNMARKED_RULES, type HrRules } from "../../constants";
import { leaveYearLabel } from "../calc";
import { monthLabel } from "../types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A short summary of the rules a month's salary is worked out with. Renders on the server or the client. */
export function HowItWorks({
  rules,
  month,
  finalised,
  rulesHref,
  withSalary,
}: {
  rules: HrRules;
  month: string;
  finalised: boolean;
  /** Link to the Rules tab, for people who may open it. */
  rulesHref: string | null;
  withSalary: boolean;
}) {
  const basis = SALARY_BASES.find((b) => b.value === rules.salaryBasis);
  const unmarked = UNMARKED_RULES.find((u) => u.value === rules.unmarkedDays);
  const late =
    rules.lateMarksPerHalfDay > 0
      ? `Arriving more than ${formatNumber(rules.graceMinutes)} minutes after ${rules.workStart} is late. Every ${formatNumber(rules.lateMarksPerHalfDay)} late arrivals in a month cost half a day's salary.`
      : `Arriving more than ${formatNumber(rules.graceMinutes)} minutes after ${rules.workStart} is counted as late, but does not reduce the salary.`;
  const overtime =
    rules.overtimeRate > 0
      ? `Hours past a full day of ${formatNumber(rules.fullDayHours)} hours, and hours worked on a weekly off or holiday, are paid at ${formatNumber(rules.overtimeRate)} times the hourly rate (a day's salary ÷ ${formatNumber(rules.fullDayHours)}).`
      : "Overtime is not paid.";
  const leaves = rules.leaveTypes.length
    ? rules.leaveTypes
        .map((t) => `${t.name} (${t.code}): ${t.paid ? (t.yearlyQuota === null ? "paid, no limit" : `${formatNumber(t.yearlyQuota)} paid days a year`) : "unpaid"}`)
        .join("; ")
    : "No leave types are set, so leave is not paid.";

  const items: [string, string][] = [
    ["Salary basis", `${basis?.label ?? rules.salaryBasis}. ${basis?.description ?? ""}`],
    ["Days nobody marked", `${unmarked?.label ?? rules.unmarkedDays}. ${unmarked?.description ?? ""}`],
    ["Late arrivals", late],
    ["Overtime", overtime],
    [
      "Leave allowances",
      `${leaves}. Leave year ${leaveYearLabel(month, rules.leaveYearStartMonth)}, starting in ${MONTHS[rules.leaveYearStartMonth - 1] ?? "January"}. Paid leave beyond the allowance is loss of pay.`,
    ],
  ];

  return (
    <Section
      title="How this is worked out"
      description={finalised ? `The rules saved when ${monthLabel(month)} was finalised.` : "From the current attendance rules."}
      actions={
        rulesHref ? (
          <Link href={rulesHref} className="text-sm font-medium text-brand-ink hover:underline">
            Attendance rules
          </Link>
        ) : null
      }
    >
      <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
        {items.map(([label, text]) => (
          <div key={label} className="min-w-0">
            <dt className="font-medium">{label}</dt>
            <dd className="text-pretty text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 flex gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          This page does not change Expenses. Salary expenses are still posted by each person&apos;s salary schedule in Recurring expenses.
          {withSalary ? " The Booked in Expenses column shows what is there for the month." : null}
        </span>
      </p>
    </Section>
  );
}
