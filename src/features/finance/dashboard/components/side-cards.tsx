import Link from "next/link";
import { ArrowUpRight, BadgeIndianRupee, FolderKanban, PackagePlus, Percent, Receipt, Repeat } from "lucide-react";
import { Section } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { reportQueryString } from "@/features/reports/schemas";
import type { FinanceDashboardData } from "../types";

const ACTIONS = [
  { title: "Add expense", href: "/finance/expenses?new=1", icon: Receipt, hint: "Bills and receipts" },
  { title: "Record income", href: "/finance/income?new=1", icon: BadgeIndianRupee, hint: "Client payments" },
  { title: "New project", href: "/finance/projects?new=1", icon: FolderKanban, hint: "Budget and stages" },
  { title: "Purchase stock", href: "/inventory/purchase", icon: PackagePlus, hint: "Add to inventory" },
] as const;

export function QuickActions() {
  return (
    <Section title="Quick actions" contentClassName="grid grid-cols-2 gap-2.5 p-3 sm:p-4">
      {ACTIONS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group flex flex-col gap-2.5 rounded-lg border bg-surface/40 p-3 transition-colors hover:border-brand/40 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors group-hover:text-brand-ink">
            <a.icon className="size-4" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-medium">{a.title}</span>
            <span className="block text-xs text-muted-foreground">{a.hint}</span>
          </span>
        </Link>
      ))}
    </Section>
  );
}

/** GST paid on expense invoices in the selected period. */
export function GstSummary({ data }: { data: FinanceDashboardData }) {
  const { gstPaid, expenses } = data.kpis;
  const share = expenses > 0 ? gstPaid / expenses : null;
  // Open the GST report itself, on the same period as the card.
  const qs = reportQueryString(data.periodDates ?? {});
  const reportHref = `/finance/reports?report=gst${qs ? `&${qs}` : ""}`;
  return (
    <Section
      title="GST summary"
      description={data.periodLabel}
      actions={
        <Link href={reportHref} className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
          GST report <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/12 text-info">
          <Percent className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">GST paid on expenses</p>
          <Money value={gstPaid} className="block text-2xl font-semibold tracking-tight" />
          <p className="mt-1 text-xs text-muted-foreground">
            {gstPaid > 0 && share !== null ? `${formatPercent(share)} of expenses ${data.periodPhrase}.` : "No GST invoices recorded on expenses in this period."}
          </p>
          {/* The GST report's input tax credit also counts stock purchase invoices, so it can be higher than this card. */}
          <p className="mt-1 text-xs text-muted-foreground">GST on stock purchases is not included here. The GST report counts both.</p>
        </div>
      </div>
    </Section>
  );
}

/** What active recurring schedules commit each month, and the next three due items. */
export function RecurringCommitmentsCard({ data }: { data: FinanceDashboardData }) {
  const { perMonth, salariesPerMonth, activeCount, upcoming } = data.recurring;
  return (
    <Section
      title="Recurring commitments"
      description={activeCount === 0 ? "No active schedules" : `${formatNumber(activeCount)} active ${activeCount === 1 ? "schedule" : "schedules"}`}
      actions={
        <Link href="/finance/recurring" className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
          All schedules <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      }
    >
      {activeCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Salaries, rent and subscriptions you set up as schedules are posted automatically and counted here.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand-ink">
              <Repeat className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">Committed per month</p>
              <Money value={perMonth} className="block text-2xl font-semibold tracking-tight" />
              <p className="mt-1 text-xs text-muted-foreground">
                of which salaries <Money value={salariesPerMonth} className="font-medium text-foreground" />
              </p>
            </div>
          </div>
          {upcoming.length ? (
            <div>
              <p className="eyebrow text-[10px]">Next due</p>
              <ul className="mt-1.5 divide-y">
                {upcoming.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/finance/recurring?view=${u.id}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-foreground"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{u.name}</span>
                        <span className="block text-xs text-muted-foreground">{formatDate(u.date)}</span>
                      </span>
                      <Money value={u.amount} className="shrink-0 font-medium" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}
