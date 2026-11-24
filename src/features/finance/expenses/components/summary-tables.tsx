import Link from "next/link";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { formatNumber, formatPercent } from "@/lib/format";
import type { NatureSplit, PaymentSplit, Slice, YearPoint } from "../summary-queries";

/** Tables of the Expense summary. Server components: plain links, no client code. */

/** A list link for the same date range plus one filter, so a row opens exactly the expenses it adds up. */
export function listHref(range: { from: string; to: string }, filter?: Record<string, string>) {
  const p = new URLSearchParams({ ...(filter ?? {}), from: range.from, to: range.to });
  return `/finance/expenses?${p.toString()}`;
}

/**
 * Category, project or vendor rows with their share of the range's total. `hrefOf` links a row to
 * the Expenses list filtered to it; rows without one (a deleted project) are plain text.
 */
export function SliceTable({
  rows,
  label,
  total,
  hrefOf,
  footnote,
}: {
  rows: Slice[];
  label: string;
  total: number;
  hrefOf: (row: Slice) => string | null;
  footnote?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[340px]">
        <TableHeader>
          <TableRow>
            <TableHead>{label}</TableHead>
            <TableHead className="text-right">Expenses</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden w-32 sm:table-cell">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const share = total > 0 ? r.total / total : 0;
            const href = hrefOf(r);
            return (
              <TableRow key={r.key}>
                <TableCell className="max-w-56">
                  {href ? (
                    <Link href={href} className="block truncate font-medium hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium">{r.label}</span>
                  )}
                </TableCell>
                <TableCell className="tabular text-right text-muted-foreground">{formatNumber(r.count)}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.total} className="font-medium" />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, share * 100)}%` }} />
                    </span>
                    <span className="tabular w-11 text-right text-xs text-muted-foreground">{formatPercent(share)}</span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        {footnote ? (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-xs font-normal whitespace-normal text-muted-foreground">
                {footnote}
              </TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

/** Every financial year with expenses, newest first. */
export function YearTable({ rows, current }: { rows: YearPoint[]; current: string }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[300px]">
        <TableHeader>
          <TableRow>
            <TableHead>Financial year</TableHead>
            <TableHead className="text-right">Expenses</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((y) => (
            <TableRow key={y.startYear}>
              <TableCell>
                <Link href={listHref({ from: `${y.startYear}-04-01`, to: `${y.startYear + 1}-03-31` })} className="font-medium whitespace-nowrap hover:underline">
                  {y.label}
                </Link>
                {y.label === current ? <span className="ml-2 text-xs text-muted-foreground">so far</span> : null}
              </TableCell>
              <TableCell className="tabular text-right text-muted-foreground">{formatNumber(y.count)}</TableCell>
              <TableCell className="text-right">
                <Money value={y.total} className="font-medium" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type SplitRow = { key: string; label: string; hint: string; value: number; href: string | null; tone: string };

/** One labelled row with a bar showing its part of the whole. */
function SplitList({ rows, whole }: { rows: SplitRow[]; whole: number }) {
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => {
        const share = whole > 0 ? r.value / whole : 0;
        const label = r.href ? (
          <Link href={r.href} className="font-medium hover:underline">
            {r.label}
          </Link>
        ) : (
          <span className="font-medium">{r.label}</span>
        );
        return (
          <li key={r.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                {label}
                <span className="block text-xs text-muted-foreground">{r.hint}</span>
              </span>
              <span className="shrink-0 text-right">
                <Money value={r.value} className="font-semibold" />
                <span className="tabular block text-xs text-muted-foreground">{formatPercent(share)}</span>
              </span>
            </div>
            <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className={`block h-full rounded-full ${r.tone}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Paid vs still owed on the expenses of the range, as of today. Every part adds up to the total:
 * paid so far, the owed part of each open status, and stock used from inventory (paid at purchase).
 */
export function PaymentSplitList({ split, total }: { split: PaymentSplit; total: number }) {
  const rows: SplitRow[] = [
    { key: "paid", label: "Paid", hint: "Paid so far on these expenses", value: split.paid, href: "/finance/payments?tab=paid", tone: "bg-success" },
    { key: "unpaid", label: "Unpaid, not yet due", hint: "Nothing paid, due date not passed", value: split.unpaid, href: "/finance/payments", tone: "bg-warning" },
    { key: "partial", label: "Rest of part-paid bills", hint: "Part paid, the rest not yet due", value: split.partial, href: "/finance/payments?tab=partial", tone: "bg-info" },
    { key: "overdue", label: "Overdue", hint: "Past the due date and still owed", value: split.overdue, href: "/finance/payments?tab=overdue", tone: "bg-danger" },
  ];
  if (split.fromStock > 0) {
    rows.push({ key: "stock", label: "Stock used from inventory", hint: "Paid when the stock was bought", value: split.fromStock, href: null, tone: "bg-muted-foreground/50" });
  }
  return <SplitList rows={rows} whole={total} />;
}

/** Direct vs indirect expenses of the range, each linked to the list filtered to it. */
export function NatureSplitList({
  nature,
  total,
  range,
}: {
  nature: NatureSplit;
  total: number;
  range: { from: string; to: string };
}) {
  const count = (n: number) => `${formatNumber(n)} ${n === 1 ? "expense" : "expenses"}`;
  // The list filtered to a nature also shows stock counted at purchase (outside its totals), so its row count can be higher.
  const alsoListed = (n: number) => (n > 0 ? `. The list also shows ${formatNumber(n)} stock ${n === 1 ? "row" : "rows"} already counted when bought` : "");
  return (
    <SplitList
      whole={total}
      rows={[
        {
          key: "direct",
          label: "Direct",
          hint: `${count(nature.directCount)}: on a project, or in a direct category${alsoListed(nature.directCountedAtPurchase)}`,
          value: nature.direct,
          href: listHref(range, { nature: "direct" }),
          tone: "bg-chart-1",
        },
        {
          key: "indirect",
          label: "Indirect (overhead)",
          hint: `${count(nature.indirectCount)}: no project, in an indirect category${alsoListed(nature.indirectCountedAtPurchase)}`,
          value: nature.indirect,
          href: listHref(range, { nature: "indirect" }),
          tone: "bg-chart-2",
        },
      ]}
    />
  );
}
