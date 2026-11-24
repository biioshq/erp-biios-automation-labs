import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, Boxes, Briefcase, CalendarClock, CircleCheck, FolderKanban, Gauge, HandCoins, PackagePlus, Receipt, Store, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber, formatPercent } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer, userCanOpen } from "@/features/analytics/viewer";
import { getBusinessInsights } from "@/features/analytics/insights/business";
import { RULES } from "@/features/analytics/dashboard/rules";
import { DetailsLink, Footnote, InsightCard, RuleList } from "@/features/analytics/dashboard/components/bits";
import { PartyTable, ProjectsTable, RequirementsTable } from "@/features/analytics/insights/components/tables";

export const metadata: Metadata = { title: "Business performance" };

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default async function BusinessPerformancePage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.insights)) return <NoAccess eyebrow="Analytics & Planning" title="Business performance" />;
  const data = await getBusinessInsights(analyticsViewer(user));
  // A card or chart shows only when its page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const c = data.counts;

  return (
    <Page>
      <PageHeader
        eyebrow="Management insights"
        title="Business performance"
        description="Projects, the money committed and spent on them, stock, and what the company owes suppliers, as recorded today."
        actions={
          <>
            {open("/finance/projects") ? (
              <Button asChild variant="outline">
                <Link href="/finance/projects">
                  <FolderKanban /> Projects
                </Link>
              </Button>
            ) : null}
            {open("/analytics") ? (
              <Button asChild variant="outline">
                <Link href="/analytics">
                  <Gauge /> Analytics dashboard
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        {open("/finance/projects?status=active") ? (
          <InsightCard
            href="/finance/projects?status=active"
            label="Active projects"
            value={formatNumber(c.active)}
            icon={Briefcase}
            tone="info"
            hint={`${formatNumber(c.planning)} planning, ${formatNumber(c.onHold)} on hold`}
            linkLabel="Projects"
          />
        ) : null}
        {open("/finance/projects?status=completed") ? (
          <InsightCard href="/finance/projects?status=completed" label="Completed projects" value={formatNumber(c.completed)} icon={CircleCheck} tone="success" hint={c.cancelled ? `${formatNumber(c.cancelled)} cancelled` : "None cancelled"} linkLabel="Projects" />
        ) : null}
        {open("/analytics/projects/performance") ? (
          <InsightCard
            href="/analytics/projects/performance"
            label="Delayed or at risk"
            value={formatNumber(c.delayed)}
            icon={CalendarClock}
            tone={c.delayed > 0 ? "warning" : "success"}
            hint="Active, with overdue tasks or past the end date"
          />
        ) : null}
        <StatCard
          label="Total project value"
          value={data.value.withValue ? <Money value={data.value.total} /> : "Not recorded"}
          icon={HandCoins}
          tone="brand"
          hint={data.value.withValue ? `Contract values of ${formatNumber(data.value.withValue)} of ${plural(data.value.projects, "project")}` : "No project has a contract value yet"}
        />
        <StatCard label="Total estimated cost" value={<Money value={data.budget.total} />} icon={Wallet} hint={`Budgets of ${plural(data.budget.projects, "project")}, cancelled left out`} />
        <StatCard
          label="Actual project spend"
          value={<Money value={data.spent} />}
          icon={Receipt}
          tone="warning"
          hint={
            <>
              Company expenses in {data.companyExpenses.label}: <Money value={data.companyExpenses.amount} compact />
            </>
          }
        />
        {open("/analytics/projects/budget?status=active") ? (
          <InsightCard
            href="/analytics/projects/budget?status=active"
            label="Budget used (active projects with a budget)"
            value={data.budgetUse.usage === null ? "No budgets" : formatPercent(data.budgetUse.usage)}
            icon={Gauge}
            tone={data.budgetUse.usage !== null && data.budgetUse.usage > 1 ? "danger" : "info"}
            hint={
              <>
                <Money value={data.budgetUse.spent} compact /> of <Money value={data.budgetUse.budget} compact />
              </>
            }
          />
        ) : null}
        {open("/inventory") ? (
          <InsightCard
            href="/inventory"
            label="Current inventory value"
            value={<Money value={data.inventory.value} />}
            icon={Boxes}
            tone="brand"
            hint={`${plural(data.inventory.items, "item")}, ${formatNumber(data.inventory.lowStock + data.inventory.outOfStock)} low or out`}
            linkLabel="Inventory"
          />
        ) : null}
        {open("/finance/payments") ? (
          <InsightCard
            href="/finance/payments"
            label="Outstanding vendor payments"
            value={<Money value={data.payables.total} />}
            icon={Store}
            tone={data.payables.overdue > 0 ? "danger" : "default"}
            hint={
              data.payables.count
                ? `${plural(data.payables.count, "bill")}, ${data.payables.overdue > 0 ? "some overdue" : "none overdue"}${data.salariesHidden ? "" : ", salary bills included"}`
                : "Every bill is paid"
            }
            linkLabel="Payments"
          />
        ) : null}
        {open("/analytics/forecasting/purchases") ? (
          <InsightCard
            href="/analytics/forecasting/purchases"
            label="Upcoming procurement"
            value={plural(data.requirementTotals.count, "item")}
            icon={PackagePlus}
            tone={data.requirementTotals.count > 0 ? "warning" : "default"}
            hint={
              data.requirementTotals.count ? (
                <>
                  About <Money value={data.requirementTotals.cost} compact /> to cover the next 30 days
                </>
              ) : (
                "Nothing to buy for the next 30 days"
              )
            }
          />
        ) : null}
      </StatGrid>

      <SalariesHiddenNote />

      <RuleList
        rules={[
          { label: "Total project value", text: "The contract value agreed with the client, where it is recorded on the project. Projects without one are not counted, so the total may be lower than the real value." },
          { label: "Total estimated cost", text: "The current budget of every project that is not cancelled." },
          { label: "Actual project spend", text: "Every expense booked to those projects, including stock issued to them. Company expenses for the financial year are shown under it for scale." },
          { label: "Budget used", text: RULES.budget },
          { label: "Delayed or at risk", text: RULES.delays },
          { label: "Outstanding vendor payments", text: "What is still unpaid on recorded bills, from the same figures as Payments. For people who can see salaries this includes unpaid salary bills; others see supplier bills without them." },
          { label: "Upcoming procurement", text: RULES.purchases },
        ]}
      />

      {open("/analytics/projects") ? (
        <Section title="Projects" description="Every project that is not cancelled, newest first." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/projects">Project analytics</DetailsLink>}>
          {data.projects.length ? (
            <ProjectsTable rows={data.projects} />
          ) : (
            <EmptyState icon={FolderKanban} compact className="m-4" title="No projects yet" description="Create a project and its budget, spend and tasks show here." />
          )}
        </Section>
      ) : null}

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-5">
        {open("/analytics/forecasting/purchases") ? (
          <Section
            className="xl:col-span-3"
            title="Upcoming procurement"
            description="Items to buy so stock lasts the next 30 days, soonest order date first."
            contentClassName="p-0 sm:p-0"
            actions={<DetailsLink href="/analytics/forecasting/purchases">All requirements</DetailsLink>}
          >
            {data.requirements.length ? (
              <>
                <RequirementsTable rows={data.requirements} />
                <Footnote className="px-4 pb-4 sm:px-5">{RULES.purchases}</Footnote>
              </>
            ) : (
              <EmptyState icon={PackagePlus} compact className="m-4" title="Nothing to buy for the next 30 days" description="No item is below its minimum, and no recorded rate of use needs more than what is in stock over the next 30 days plus its lead time." />
            )}
          </Section>
        ) : null}
        {open("/finance/payments") ? (
          <Section
            className="xl:col-span-2"
            title="Owed to vendors"
            description={data.salariesHidden ? "Suppliers with unpaid bills, largest first." : "Unpaid bills by payee, largest first. Unpaid salary bills are included."}
            contentClassName="p-0 sm:p-0"
            actions={<DetailsLink href="/finance/payments">Payments</DetailsLink>}
          >
            {data.topVendors.length ? (
              <PartyTable rows={data.topVendors} label="Vendor" countLabel="Bills" />
            ) : (
              <EmptyState icon={BadgeIndianRupee} compact className="m-4" title="Nothing owed to vendors" description="Every recorded bill is paid." />
            )}
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
