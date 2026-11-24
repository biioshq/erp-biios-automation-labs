import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BadgeIndianRupee, ChartColumn, FileText, Gauge, Landmark, Receipt, ShieldCheck, Store, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer, userCanOpen } from "@/features/analytics/viewer";
import { getFinancialInsights } from "@/features/analytics/insights/financial";
import { monthLabel } from "@/features/analytics/dashboard/rules";
import { DetailsLink, Footnote, InsightCard } from "@/features/analytics/dashboard/components/bits";
import { BarsChart, MonthChart } from "@/features/analytics/dashboard/components/charts";
import { PartyTable } from "@/features/analytics/insights/components/tables";
import type { FinancialInsights } from "@/features/analytics/insights/types";

export const metadata: Metadata = { title: "Financial performance" };

const BUDGET_ROWS = 10;

function PlTable({ months, fy, fyLabel }: { months: NonNullable<FinancialInsights["pl"]>["months"]; fy: NonNullable<FinancialInsights["pl"]>["fy"]; fyLabel: string }) {
  return (
    <Table className="min-w-[560px]">
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Income</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Gross profit</TableHead>
          <TableHead className="text-right">Profit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...months].reverse().map((m) => (
          <TableRow key={m.month}>
            <TableCell className="whitespace-nowrap">{monthLabel(m.month)}</TableCell>
            <TableCell className="text-right">
              <Money value={m.income} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={m.expenses} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={m.grossProfit} tone="auto" />
            </TableCell>
            <TableCell className="text-right">
              <Money value={m.profit} tone="auto" className="font-medium" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>{fyLabel} to date</TableCell>
          <TableCell className="text-right">
            <Money value={fy.income} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={fy.expenses} />
          </TableCell>
          <TableCell className="text-right">
            <Money value={fy.grossProfit} tone="auto" />
          </TableCell>
          <TableCell className="text-right">
            <Money value={fy.profit} tone="auto" className="font-semibold" />
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function CashPosition({ cash }: { cash: NonNullable<FinancialInsights["cash"]> }) {
  const line = (label: string, value: number, strong?: boolean) => (
    <div className={cn("flex items-center justify-between gap-4 py-2", strong && "font-semibold")}>
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <Money value={value} tone={strong ? undefined : "auto"} />
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="divide-y text-sm">
        {line("Cash and bank at the start", cash.opening, true)}
        {cash.activities.map((a) => (
          <div key={a.key}>{line(a.label, a.net)}</div>
        ))}
        {line("Cash and bank now", cash.closing, true)}
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Balances today</p>
        {cash.accounts.length ? (
          <div className="divide-y text-sm">
            {cash.accounts.map((a) => (
              <div key={a.code} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate">{a.name}</span>
                <Money value={a.balance} tone="auto" className="font-medium" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No cash or bank account holds a balance.</p>
        )}
      </div>
    </div>
  );
}

export default async function FinancialPerformancePage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.insights)) return <NoAccess eyebrow="Analytics & Planning" title="Financial performance" />;
  const viewer = analyticsViewer(user);
  const data = await getFinancialInsights(viewer);
  // A card or chart shows only when its page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const hasMonthly = data.monthly.some((m) => m.income > 0 || m.expenses > 0);
  const budgetRows = [...data.budget.rows].sort((a, b) => b.spent - a.spent).slice(0, BUDGET_ROWS);

  return (
    <Page>
      <PageHeader
        eyebrow="Management insights"
        title="Financial performance"
        description={
          data.pl
            ? `Income, spending, profit and cash for ${data.fyLabel} and the last 12 months, with what customers and suppliers still owe.`
            : `Income and spending for ${data.fyLabel} and the last 12 months, with what customers and suppliers still owe.`
        }
        actions={
          <>
            {open("/finance") ? (
              <Button asChild variant="outline">
                <Link href="/finance">
                  <BadgeIndianRupee /> Finance dashboard
                </Link>
              </Button>
            ) : null}
            {viewer.cash && open("/finance/reports/profit-loss") ? (
              <Button asChild variant="outline">
                <Link href="/finance/reports/profit-loss">
                  <FileText /> Profit and loss
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        {open("/finance/income/summary") ? (
          <InsightCard href="/finance/income/summary" label={`Income received, ${data.fyLabel}`} value={<Money value={data.fy.income} />} icon={ArrowDownRight} tone="success" hint="From income records" linkLabel="Income summary" />
        ) : null}
        {open("/finance/expenses/summary") ? (
          <InsightCard href="/finance/expenses/summary" label={`Expenses recorded, ${data.fyLabel}`} value={<Money value={data.fy.expenses} />} icon={ArrowUpRight} tone="warning" hint="Company expenses, by expense date" linkLabel="Expense summary" />
        ) : null}
        {data.pl ? (
          open("/finance/reports/profit-loss") ? (
            <InsightCard
              href={`/finance/reports/profit-loss?from=${data.pl.fy.from}&to=${data.pl.fy.to}`}
              label={`Profit (P&L), ${data.fyLabel}`}
              value={<Money value={data.pl.fy.profit} tone="auto" />}
              icon={TrendingUp}
              tone={data.pl.fy.profit < 0 ? "danger" : "success"}
              hint={data.pl.fy.income > 0 ? `${formatPercent(data.pl.fy.profit / data.pl.fy.income)} of P&L income` : "No P&L income yet"}
              linkLabel="Profit and loss"
            />
          ) : null
        ) : null}
        {data.cash ? (
          open("/finance/assets/cash") ? (
            <InsightCard
              href="/finance/assets/cash"
              label="Cash and bank today"
              value={<Money value={data.cash.closing} tone="auto" />}
              icon={Landmark}
              tone="brand"
              hint={
                <>
                  <Money value={data.cash.netChange} tone="auto" /> since 1 April
                </>
              }
              linkLabel="Cash and bank"
            />
          ) : null
        ) : null}
        {open("/finance/invoices?status=unpaid,partial,overdue") ? (
          <InsightCard
            href="/finance/invoices?status=unpaid,partial,overdue"
            label="Receivables outstanding"
            value={<Money value={data.receivables.total} />}
            icon={Receipt}
            tone={data.receivables.overdue > 0 ? "danger" : "info"}
            hint={data.receivables.count ? `${formatNumber(data.receivables.count)} open invoices, ${data.receivables.overdueCount} overdue` : "Every invoice is received"}
            linkLabel="Invoices"
          />
        ) : null}
        {open("/finance/payments") ? (
          <InsightCard
            href="/finance/payments"
            label="Payables outstanding"
            value={<Money value={data.payables.total} />}
            icon={Store}
            tone={data.payables.overdue > 0 ? "danger" : "default"}
            hint={data.payables.count ? `${formatNumber(data.payables.count)} unpaid bills, ${data.payables.overdueCount} overdue` : "Every bill is paid"}
            linkLabel="Payments"
          />
        ) : null}
        {open("/analytics/projects/budget?status=active") ? (
          <InsightCard
            href="/analytics/projects/budget?status=active"
            label="Budget used (active projects with a budget)"
            value={data.budget.total.usage === null ? "No budgets" : formatPercent(data.budget.total.usage)}
            icon={Gauge}
            tone={data.budget.total.usage !== null && data.budget.total.usage > 1 ? "danger" : "info"}
            hint={
              <>
                <Money value={data.budget.total.spent} compact /> of <Money value={data.budget.total.budget} compact />
              </>
            }
          />
        ) : null}
      </StatGrid>

      {open("/finance") ? (
        <Section
          title="Revenue and expense trend"
          description="Income received and expenses recorded each month, by the date on each record and GST included, whether a bill is paid yet or not. The same figures as the Finance dashboard."
          actions={<DetailsLink href="/finance" />}
        >
          {hasMonthly ? (
            <MonthChart
              title="Income received and expenses recorded by month"
              data={data.monthly}
              series={[
                { key: "income", label: "Income received", color: "var(--chart-3)" },
                { key: "expenses", label: "Expenses recorded", color: "var(--chart-2)" },
              ]}
            />
          ) : (
            <EmptyState icon={ChartColumn} compact title="No income or expenses in the last 12 months" />
          )}
        </Section>
      ) : null}

      {data.pl ? (
        open("/finance/reports/profit-loss") ? (
          <Section
            title="Profitability trend"
            description="Profit each month from the profit and loss statement: invoices as revenue, stock as cost when used, depreciation and loan interest included. It differs from the cash figures above."
            actions={<DetailsLink href="/finance/reports/profit-loss">Profit and loss</DetailsLink>}
          >
            {data.pl.months.some((m) => m.income !== 0 || m.expenses !== 0) ? (
              <MonthChart title="P&L profit by month" data={data.pl.months} series={[{ key: "profit", label: "Profit", color: "var(--chart-1)" }]} />
            ) : (
              <EmptyState icon={TrendingUp} compact title="No income or expenses in the books for the last 12 months" />
            )}
            <div className="-mx-4 mt-4 border-t sm:-mx-5">
              <PlTable months={data.pl.months} fy={data.pl.fy} fyLabel={data.fyLabel} />
            </div>
          </Section>
        ) : null
      ) : null}

      {data.cash ? (
        open("/finance/reports/cash-flow") ? (
          <Section
            title="Cash flow position"
            description={`Cash and bank movements from 1 April to today, by activity. Transfers between own accounts are left out.`}
            actions={<DetailsLink href="/finance/reports/cash-flow">Cash flow statement</DetailsLink>}
          >
            <CashPosition cash={data.cash} />
          </Section>
        ) : null
      ) : (
        <EmptyState icon={ShieldCheck} compact title="Profit and cash figures are not shown for your role" description="The profit and loss trend and the cash position need permission to see the company's financial position. Ask an admin if you need a figure from them." />
      )}

      {open("/analytics/projects/budget?status=planning,active,on_hold") ? (
        <Section title="Budget utilisation" description="Open projects with the most spend: budget against spend to date." actions={<DetailsLink href="/analytics/projects/budget?status=planning,active,on_hold">Budget vs actual</DetailsLink>}>
          {budgetRows.length ? (
            <BarsChart
              title="Budget and spend per open project"
              data={budgetRows}
              series={[
                { key: "budget", label: "Budget", color: "var(--chart-3)" },
                { key: "spent", label: "Spent", color: "var(--chart-1)" },
              ]}
            />
          ) : (
            <EmptyState icon={Gauge} compact title="No open project has a budget or spend yet" />
          )}
          <SalariesHiddenNote className="mt-3" />
        </Section>
      ) : null}

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        {open("/finance/invoices?status=unpaid,partial,overdue") ? (
          <Section
            title="Outstanding receivables"
            description={`Customers with unpaid invoices. ${data.receivables.dueSoon > 0 ? "Some fall due in the next 30 days." : ""}`}
            contentClassName="p-0 sm:p-0"
            actions={<DetailsLink href="/finance/invoices?status=unpaid,partial,overdue">Open invoices</DetailsLink>}
          >
            {data.topClients.length ? (
              <PartyTable rows={data.topClients} label="Customer" countLabel="Invoices" />
            ) : (
              <EmptyState icon={Receipt} compact className="m-4" title="No open invoices" description="Every issued invoice is fully received." />
            )}
          </Section>
        ) : null}
        {open("/finance/payments") ? (
          <Section title="Outstanding payables" description={viewer.salaries ? "Unpaid bills by payee, largest first. Unpaid salary bills are included." : "Suppliers with unpaid bills, largest first."} contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/finance/payments">Payments</DetailsLink>}>
            {data.topVendors.length ? (
              <>
                <PartyTable rows={data.topVendors} label="Vendor" countLabel="Bills" />
                {data.payables.salariesLeftOut ? <Footnote className="px-4 pb-4 sm:px-5">Salary bills are left out.</Footnote> : null}
              </>
            ) : (
              <EmptyState icon={Store} compact className="m-4" title="Nothing owed to vendors" description="Every recorded bill is paid." />
            )}
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
