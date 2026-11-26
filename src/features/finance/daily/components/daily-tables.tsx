import Link from "next/link";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatDateShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerRow, DailyDay, DailyOverview, TransactionKind, TransactionRow, VendorRow } from "../types";

/** Tables of the Daily overview. Server components: plain links, no client code. */

const dash = <span className="text-muted-foreground">-</span>;
const money = (v: number, tone?: "positive" | "negative") => (v ? <Money value={v} tone={tone} /> : dash);

/** One row per day of a range, with what was owed at the end of that day. */
export function DayTable({ days, net, total }: { days: DailyDay[]; net: DailyOverview["net"]; total: DailyOverview["totals"] }) {
  const ledger = net?.basis === "ledger";
  const records = net?.basis === "records";
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Income received</TableHead>
            <TableHead className="text-right">Expenses incurred</TableHead>
            <TableHead className="text-right">Payments made</TableHead>
            <TableHead className="text-right">Owed at end of day</TableHead>
            {ledger ? <TableHead className="text-right">Net cash flow</TableHead> : records ? <TableHead className="text-right">Received less paid</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((d) => {
            const quiet = !d.income && !d.expenses && !d.payments && !d.netCash;
            const dayNet = ledger ? (d.netCash ?? 0) : d.income - d.payments;
            return (
              <TableRow key={d.day} className={cn(quiet && "text-muted-foreground")}>
                <TableCell className="font-medium whitespace-nowrap">
                  <Link href={`/finance/daily?day=${d.day}`} className="hover:underline">
                    {formatDateShort(fromDateInput(d.day))}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{money(d.income)}</TableCell>
                <TableCell className="text-right">{money(d.expenses)}</TableCell>
                <TableCell className="text-right">{money(d.payments)}</TableCell>
                <TableCell className="text-right">
                  {d.outstanding ? (
                    <>
                      <Money value={d.outstanding} />
                      {d.overdue ? <span className="ml-1.5 text-xs text-danger">(<Money value={d.overdue} /> overdue)</span> : null}
                    </>
                  ) : (
                    dash
                  )}
                </TableCell>
                {ledger || records ? <TableCell className="text-right">{dayNet ? <Money value={dayNet} tone="auto" /> : dash}</TableCell> : null}
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right">
              <Money value={total.income} className="font-semibold" />
            </TableCell>
            <TableCell className="text-right">
              <Money value={total.expenses} className="font-semibold" />
            </TableCell>
            <TableCell className="text-right">
              <Money value={total.payments} className="font-semibold" />
            </TableCell>
            <TableCell className="text-right text-xs font-normal text-muted-foreground">Owed is a balance, not added up</TableCell>
            {net ? (
              <TableCell className="text-right">
                <Money value={net.value} tone="auto" className="font-semibold" />
              </TableCell>
            ) : null}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/** Vendors billed, paid and still owed. Rows open the Expenses list for the same dates. */
export function VendorTable({ rows, range }: { rows: VendorRow[]; range: { from: string; to: string } }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[380px]">
        <TableHeader>
          <TableRow>
            <TableHead>Vendor or payee</TableHead>
            <TableHead className="text-right">Incurred</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Owed at end</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const p = new URLSearchParams({ vendor: r.vendor, from: range.from, to: range.to });
            return (
              <TableRow key={r.key}>
                <TableCell className="max-w-56 whitespace-normal sm:whitespace-nowrap">
                  <Link href={`/finance/expenses?${p.toString()}`} className="block font-medium hover:underline sm:truncate">
                    {r.vendor || "No vendor"}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{money(r.incurred)}</TableCell>
                <TableCell className="text-right">{money(r.paid)}</TableCell>
                <TableCell className="text-right">{money(r.owed)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Customers and what they paid. Rows open the Income list for the same dates. */
export function CustomerTable({ rows, range }: { rows: CustomerRow[]; range: { from: string; to: string } }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[300px]">
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">Receipts</TableHead>
            <TableHead className="text-right">Income received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const p = new URLSearchParams({ q: r.client, from: range.from, to: range.to });
            return (
              <TableRow key={r.key}>
                <TableCell className="max-w-56 whitespace-normal sm:whitespace-nowrap">
                  <Link href={`/finance/income?${p.toString()}`} className="block font-medium hover:underline sm:truncate">
                    {r.client || "No name"}
                  </Link>
                </TableCell>
                <TableCell className="tabular text-right text-muted-foreground">{formatNumber(r.count)}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.received} className="font-medium" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const KIND: Record<TransactionKind, { label: string; className: string }> = {
  expense: { label: "Expense billed", className: "bg-chart-1/12 text-chart-1" },
  payment: { label: "Payment made", className: "bg-chart-2/14 text-chart-2" },
  receipt: { label: "Income received", className: "bg-chart-3/12 text-chart-3" },
  transfer: { label: "Own-account transfer", className: "bg-muted text-muted-foreground" },
};

/** Expenses billed, payments made, receipts and transfers of the period, newest first. */
export function TransactionTable({ rows, showDay }: { rows: TransactionRow[]; showDay: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            {showDay ? <TableHead>Day</TableHead> : null}
            <TableHead>Type</TableHead>
            <TableHead>Vendor or customer</TableHead>
            <TableHead className="hidden md:table-cell">Details</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              {showDay ? <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(fromDateInput(r.day))}</TableCell> : null}
              <TableCell>
                <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", KIND[r.kind].className)}>{KIND[r.kind].label}</span>
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal sm:whitespace-nowrap">
                {r.href ? (
                  <Link href={r.href} className="block font-medium hover:underline sm:truncate">
                    {r.party || "No name"}
                  </Link>
                ) : (
                  <span className="block font-medium sm:truncate">{r.party}</span>
                )}
                <span className="block text-xs text-muted-foreground">{r.title}</span>
              </TableCell>
              <TableCell className="hidden max-w-72 text-muted-foreground md:table-cell">
                <span className="block truncate">{r.detail}</span>
              </TableCell>
              <TableCell className="text-right">
                <Money value={r.amount} className="font-medium" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
