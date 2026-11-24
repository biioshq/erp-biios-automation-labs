import Link from "next/link";
import { TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LimitedTable } from "@/components/shared/limited-table";
import { Money } from "@/components/shared/money";
import { INCOME_CATEGORIES, labelOf } from "@/lib/constants";
import { formatDate, formatNumber, round2 } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { DAY_LIMIT, type CategoryRow, type DayRow, type OpenInvoiceRow, type PartyRow, type YearRow } from "../summary";

const sum = <T,>(rows: T[], pick: (r: T) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));

/** Days with receipts, newest first. */
export function DailyTable({ rows, from, to }: { rows: DayRow[]; from: string; to: string }) {
  return (
    <LimitedTable
      className="min-w-[320px]"
      header={
      <TableHeader>
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead className="text-right">Receipts</TableHead>
          <TableHead className="text-right">Cash received</TableHead>
        </TableRow>
      </TableHeader>
      }
      rows={rows.map((d) => (
          <TableRow key={d.day}>
            <TableCell>
              <Link href={`/finance/income?from=${d.day}&to=${d.day}`} className="whitespace-nowrap hover:underline">
                {formatDate(fromDateInput(d.day))}
              </Link>
            </TableCell>
            <TableCell className="tabular text-right">{formatNumber(d.count)}</TableCell>
            <TableCell className="text-right">
              <Money value={d.received} className="font-medium" />
            </TableCell>
          </TableRow>
        ))}
      footer={
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3} className="text-xs font-normal text-muted-foreground">
            The {rows.length === DAY_LIMIT ? `${formatNumber(DAY_LIMIT)} most recent days` : `${formatNumber(rows.length)} ${rows.length === 1 ? "day" : "days"}`} with receipts between {formatDate(fromDateInput(from))} and{" "}
            {formatDate(fromDateInput(to))}.
          </TableCell>
        </TableRow>
      </TableFooter>
      }
    />
  );
}

/** Every financial year with records, newest first. */
export function YearTable({ rows }: { rows: YearRow[] }) {
  return (
    <LimitedTable
      className="min-w-[320px]"
      header={
      <TableHeader>
        <TableRow>
          <TableHead>Financial year</TableHead>
          <TableHead className="text-right">Cash received</TableHead>
          <TableHead className="text-right">Invoiced</TableHead>
        </TableRow>
      </TableHeader>
      }
      rows={rows.map((y) => {
          const end = `${Number(y.start.slice(0, 4)) + 1}-03-31`;
          return (
            <TableRow key={y.label}>
              <TableCell>
                <Link href={`/finance/income/summary?from=${y.start}&to=${end}`} className="whitespace-nowrap font-medium hover:underline">
                  {y.label}
                </Link>
              </TableCell>
              <TableCell className="text-right">
                <Money value={y.received} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={y.invoiced} />
              </TableCell>
            </TableRow>
          );
        })}
    />
  );
}

export function CategoryTable({ rows, from, to }: { rows: CategoryRow[]; from: string; to: string }) {
  return (
    <LimitedTable
      className="min-w-[320px]"
      header={
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Receipts</TableHead>
          <TableHead className="text-right">Cash received</TableHead>
        </TableRow>
      </TableHeader>
      }
      rows={rows.map((c) => (
          <TableRow key={c.category}>
            <TableCell>
              <Link href={`/finance/income?category=${c.category}&from=${from}&to=${to}`} className="hover:underline">
                {labelOf(INCOME_CATEGORIES, c.category)}
              </Link>
            </TableCell>
            <TableCell className="tabular text-right">{formatNumber(c.count)}</TableCell>
            <TableCell className="text-right">
              <Money value={c.received} className="font-medium" />
            </TableCell>
          </TableRow>
        ))}
      footer={
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="tabular text-right">{formatNumber(rows.reduce((s, r) => s + r.count, 0))}</TableCell>
          <TableCell className="text-right">
            <Money value={sum(rows, (r) => r.received)} />
          </TableCell>
        </TableRow>
      </TableFooter>
      }
    />
  );
}

/** Project-wise or customer-wise: received and invoiced in the range, outstanding as of today. */
export function PartyTable({ rows, label }: { rows: PartyRow[]; label: string }) {
  return (
    <LimitedTable
      className="sm:min-w-[560px]"
      header={
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          <TableHead className="text-right">Cash received</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Invoiced</TableHead>
          <TableHead className="text-right">
            Outstanding<span className="hidden sm:inline"> today</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      }
      rows={rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="max-w-64 whitespace-normal sm:whitespace-nowrap">
              {r.href ? (
                <Link href={r.href} className="block font-medium hover:underline sm:truncate">
                  {r.name}
                </Link>
              ) : (
                <span className="block text-muted-foreground sm:truncate">{r.name}</span>
              )}
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.received} />
            </TableCell>
            <TableCell className="hidden text-right sm:table-cell">
              <Money value={r.invoiced} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.outstanding} className={r.overdue > 0 ? "font-medium text-danger" : "font-medium"} />
              {r.overdue > 0 ? (
                <p className="text-[11px] text-danger">
                  <Money value={r.overdue} /> overdue
                </p>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      footer={
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="text-right">
            <Money value={sum(rows, (r) => r.received)} />
          </TableCell>
          <TableCell className="hidden text-right sm:table-cell">
            <Money value={sum(rows, (r) => r.invoiced)} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={sum(rows, (r) => r.outstanding)} />
          </TableCell>
        </TableRow>
      </TableFooter>
      }
    />
  );
}

export function OpenInvoicesTable({ rows }: { rows: OpenInvoiceRow[] }) {
  return (
    <LimitedTable
      className="min-w-[440px]"
      header={
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-right">Outstanding</TableHead>
        </TableRow>
      </TableHeader>
      }
      rows={rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link href={`/finance/invoices?view=${r.id}`} className="font-medium hover:underline">
                {r.client}
              </Link>
              <p className="font-mono text-[11px] text-muted-foreground">{r.number}</p>
            </TableCell>
            <TableCell className={r.overdue ? "whitespace-nowrap font-medium text-danger" : "whitespace-nowrap text-muted-foreground"}>
              {r.dueDate ? formatDate(fromDateInput(r.dueDate)) : "Not set"}
              {r.overdue ? <p className="text-[11px]">Overdue</p> : null}
            </TableCell>
            <TableCell className="text-right">
              <Money value={r.outstanding} className="font-medium" />
            </TableCell>
          </TableRow>
        ))}
    />
  );
}
