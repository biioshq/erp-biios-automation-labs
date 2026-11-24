import Link from "next/link";
import { ArrowUpRight, Banknote, CalendarCheck, FileText, Landmark, Receipt, Repeat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Section } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import type { DueItem, DuePayments } from "../types";

const KIND: Record<DueItem["kind"], { icon: LucideIcon; label: string }> = {
  bill: { icon: Receipt, label: "Bill" },
  loan: { icon: Banknote, label: "Loan" },
  due: { icon: Landmark, label: "Due" },
  recurring: { icon: Repeat, label: "Scheduled" },
  invoice: { icon: FileText, label: "Invoice" },
};

function DueList({ items }: { items: DueItem[] }) {
  return (
    <ul className="-mx-1 divide-y">
      {items.map((d) => {
        const kind = KIND[d.kind];
        return (
          <li key={`${d.kind}-${d.id}`}>
            <Link href={d.href} scroll={false} className="flex min-h-12 items-center gap-3 rounded-md px-1 py-2 text-sm transition-colors hover:bg-muted/60">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", d.overdue ? "bg-danger/12 text-danger" : "bg-muted text-muted-foreground")}>
                <kind.icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.party}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {kind.label} {d.title}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <Money value={d.amount} className="block font-medium" />
                <span className={cn("block text-xs", d.overdue ? "font-medium text-danger" : "text-muted-foreground")}>
                  {d.overdue ? "Overdue since " : "Due "}
                  {formatDate(d.date)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Totals({ overdue, upcoming }: { overdue: number; upcoming: number }) {
  return (
    <dl className="mb-3 grid grid-cols-2 gap-3 rounded-lg border bg-surface/40 p-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Overdue</dt>
        <dd className={cn("mt-0.5 font-semibold", overdue > 0 && "text-danger")}>
          <Money value={overdue} />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Due in 30 days</dt>
        <dd className="mt-0.5 font-semibold">
          <Money value={upcoming} />
        </dd>
      </div>
    </dl>
  );
}

const more = (shown: number, count: number) => (count > shown ? `${formatNumber(count - shown)} more not shown.` : null);

/** Money to pay and to receive that is overdue or due in the next 30 days. */
export function DuePaymentsSections({ due, isAdmin }: { due: DuePayments; isAdmin: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Section
        title="Payments to make"
        description={isAdmin ? "Supplier bills, loans, other dues and scheduled expenses" : "Supplier bills and scheduled expenses"}
        actions={
          <Link href="/finance/payments" className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
            Payment tracking <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        }
      >
        <Totals overdue={due.payOverdue} upcoming={due.payUpcoming} />
        {due.pay.length ? (
          <>
            <DueList items={due.pay} />
            {more(due.pay.length, due.payCount) ? <p className="mt-2 text-xs text-muted-foreground">{more(due.pay.length, due.payCount)}</p> : null}
          </>
        ) : (
          <EmptyState compact icon={CalendarCheck} title="Nothing to pay soon" description="No unpaid bill is overdue or due in the next 30 days." />
        )}
        {due.salariesHidden ? <p className="mt-2 text-xs text-muted-foreground">Salary bills and schedules are not listed: only admins see them.</p> : null}
        {isAdmin ? <p className="mt-2 text-xs text-muted-foreground">Loans show by their final due date. Instalment dates are not recorded.</p> : null}
      </Section>
      <Section
        title="Payments to receive"
        description="Customer invoices not fully paid"
        actions={
          <Link href="/finance/invoices" className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
            Invoices <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        }
      >
        <Totals overdue={due.receiveOverdue} upcoming={due.receiveUpcoming} />
        {due.receive.length ? (
          <>
            <DueList items={due.receive} />
            {more(due.receive.length, due.receiveCount) ? <p className="mt-2 text-xs text-muted-foreground">{more(due.receive.length, due.receiveCount)}</p> : null}
          </>
        ) : (
          <EmptyState compact icon={CalendarCheck} title="Nothing due from customers" description="No invoice is overdue or due in the next 30 days. Invoices without a due date are listed on the Invoices page." />
        )}
      </Section>
    </div>
  );
}
