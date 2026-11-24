import Link from "next/link";
import { CalendarX2, CheckCircle2, CircleAlert } from "lucide-react";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { Page, PageHeader } from "@/components/shared/page";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { StatementLine } from "@/lib/accounting";
import { ReportFilterBar } from "../report-filters";
import type { ReportColumn, ReportFilters, ReportRow } from "../../types";

/**
 * On-screen pieces of the financial statements. They render the same lines the report files
 * contain, so the page and its downloads always show the same figures.
 */

/** A line's label, linked to the page that lists its records when there is one. */
function LineLabel({ line }: { line: StatementLine }) {
  if (!line.href) return <span>{line.label}</span>;
  return (
    <Link href={line.href} className="underline-offset-4 hover:text-brand-ink hover:underline">
      {line.label}
    </Link>
  );
}

/** A group of statement lines (with their child lines indented), then the group's total. */
export function StatementBlock({ title, lines, total, totalLabel, empty }: { title: string; lines: StatementLine[]; total?: number; totalLabel?: string; empty?: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1.5">{title}</p>
      <dl className="divide-y text-sm">
        {lines.length === 0 ? <p className="py-2 text-[13px] text-muted-foreground">{empty ?? "Nothing recorded."}</p> : null}
        {lines.map((l) => (
          <div key={l.key} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 [overflow-wrap:anywhere]">
                <LineLabel line={l} />
              </dt>
              <dd className="shrink-0">
                <Money value={l.amount} exact tone={l.amount < 0 ? "auto" : undefined} />
              </dd>
            </div>
            {l.children?.length ? (
              <dl className="mt-1 space-y-1 border-l pl-3 text-[13px] text-muted-foreground">
                {l.children.map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-3">
                    <dt className="min-w-0 [overflow-wrap:anywhere]">
                      <LineLabel line={c} />
                    </dt>
                    <dd className="shrink-0">
                      <Money value={c.amount} exact />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ))}
        {total !== undefined ? (
          <div className="flex items-baseline justify-between gap-3 py-2 font-semibold">
            <dt>{totalLabel ?? `Total ${title.toLowerCase()}`}</dt>
            <dd className="shrink-0">
              <Money value={total} exact tone="auto" />
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** A grand total line under statement blocks. */
export function GrandTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-[15px] font-semibold">
      <span>{label}</span>
      <Money value={value} exact tone="auto" />
    </div>
  );
}

/** "Balanced" when two sides agree to the paisa, otherwise the difference. */
export function CheckBadge({ difference, balancedText = "Balanced" }: { difference: number; balancedText?: string }) {
  const ok = Math.abs(difference) < 0.005;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium",
        ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
      )}
    >
      {ok ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
      {ok ? (
        balancedText
      ) : (
        <span>
          Out by <Money value={difference} exact />
        </span>
      )}
    </span>
  );
}

/**
 * A statement table with one or more amount columns (the Profit & Loss by month). Labels wrap and
 * amounts stay on one line, so a table with two or three columns fits a phone; wider ones keep the
 * first column in view while the amounts scroll sideways inside the box.
 */
export function StatementMatrix({ columns, rows, caption }: { columns: ReportColumn[]; rows: ReportRow[]; caption: string }) {
  const [first, ...rest] = columns;
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-[13px] sm:text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <th scope="col" className="sticky left-0 z-10 min-w-20 bg-muted px-2 py-2 sm:min-w-72 sm:px-3">
              {first.header}
            </th>
            {rest.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-2 text-right whitespace-nowrap sm:px-3">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bold = r._kind === "subtotal";
            const label = String(r[first.key] ?? "");
            const indented = label.startsWith("    ");
            return (
              <tr key={i} className={cn("border-b last:border-b-0", bold && "bg-muted/30 font-semibold")}>
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 px-2 py-2 text-left whitespace-normal break-words sm:px-3",
                    bold ? "bg-muted font-semibold" : "bg-card font-normal",
                    indented && "pl-5 text-muted-foreground sm:pl-7",
                  )}
                >
                  {label.trim()}
                </th>
                {rest.map((c) => {
                  const v = r[c.key];
                  return (
                    <td key={c.key} className="px-2 py-2 text-right whitespace-nowrap sm:px-3">
                      {/* A heading row has no amounts: its cells stay blank rather than showing a dash. */}
                      {typeof v === "number" ? (
                        <Money value={v} exact tone={v < 0 ? "auto" : undefined} />
                      ) : bold ? null : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A period statement whose start is after its end (only a hand-edited link gets here). The period
 * filter stays, so the dates can be fixed in place.
 */
export function InvertedPeriod({ title, filters }: { title: string; filters: ReportFilters }) {
  return (
    <Page>
      <PageHeader eyebrow="Reports" title={title} />
      <ReportFilterBar meta={{ type: "profit_loss", filters: ["date"] }} filters={filters} options={{ projects: [], vendors: [], categories: [] }} />
      <EmptyState icon={CalendarX2} title="The start date is after the end date" description="Pick a period whose first day comes before its last day." />
    </Page>
  );
}

/**
 * The period button's text while no start date is picked, so it names the period the statement
 * shows by default ("This FY: 1 Apr to 24 Nov") instead of a bare "Period".
 */
export function defaultPeriodLabel(filters: ReportFilters, from: string, to: string): string | undefined {
  if (filters.from) return undefined;
  const range = `${formatDateShort(fromDateInput(from))} to ${formatDateShort(fromDateInput(to))}`;
  return filters.to ? range : `This FY: ${range}`;
}

const STATEMENTS = [
  { href: "/finance/reports/balance-sheet", label: "Balance sheet" },
  { href: "/finance/reports/profit-loss", label: "Profit & loss" },
  { href: "/finance/reports/cash-flow", label: "Cash flow" },
  { href: "/finance/reports/trial-balance", label: "Trial balance" },
];

/** Links to the other statements and the report exports, at the foot of each statement page. */
export function RelatedStatements({ current, extra = [] }: { current: string; extra?: { href: string; label: string }[] }) {
  const links = [...STATEMENTS.filter((s) => s.href !== current), ...extra, { href: "/finance/reports", label: "All reports and exports" }];
  return (
    <nav aria-label="Related pages" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
      <span>Related:</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="underline-offset-4 hover:text-foreground hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
