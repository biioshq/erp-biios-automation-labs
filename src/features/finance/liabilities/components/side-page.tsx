import Link from "next/link";
import { AlarmClock, ListChecks, Plus, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber } from "@/lib/format";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { getBankAccountOptions } from "@/server/lookups";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import { accruedCategoryOptions, groupSections, loadLiabilityGroups } from "../queries";
import { GROUP_FILTER_KEYS } from "../schemas";
import { LOAN_GROUPS, nearestBuiltIn, subgroupParents, type LiabilitySide } from "../groups";
import { GroupSectionsView } from "./group-sections-view";

const COPY: Record<LiabilitySide, { title: string; description: string; other: { href: string; label: string } }> = {
  current_liabilities: {
    title: "Current liabilities",
    description: "Everything owed within a year, group by group. Computed lines come from other records; the rest are entered here.",
    other: { href: "/finance/liabilities/non-current", label: "Non-current liabilities" },
  },
  non_current_liabilities: {
    title: "Non-current liabilities",
    description: "Long-term bank loans, business loans and other borrowings owed after more than a year, group by group.",
    other: { href: "/finance/liabilities/current", label: "Current liabilities" },
  },
};

/** The Current or Non-current liabilities page (both routes render this). Admin check is done by the route. */
export async function LiabilitySidePage({ side, searchParams }: { side: LiabilitySide; searchParams: SearchParams }) {
  const params = parseListParams(searchParams, { filterKeys: GROUP_FILTER_KEYS });
  const [data, groups, accounts, categories] = await Promise.all([groupSections(side, params), loadLiabilityGroups(), getBankAccountOptions(), accruedCategoryOptions()]);
  const copy = COPY[side];
  const parents = subgroupParents(groups, side);
  // "Add liability" opens the obligation form where the side has a non-loan group (Current), else the loan form.
  const entryKeys = data.sections.filter((s) => s.entry).flatMap((s) => s.groupKeys);
  const firstEntry = entryKeys.find((k) => !LOAN_GROUPS.includes(nearestBuiltIn(groups, k)?.key ?? "")) ?? entryKeys[0];

  return (
    <Page>
      <PageHeader
        eyebrow="Liabilities"
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <AddSubgroupButton parents={parents} defaultParent={side} label="Add new subgroup" size="default" />
            <Button asChild>
              <Link href={firstEntry ? `?new=1&newGroup=${firstEntry}` : "?new=1"} scroll={false}>
                <Plus /> Add liability
              </Link>
            </Button>
          </>
        }
      />
      <StatGrid className="xl:grid-cols-3">
        <StatCard label="On the balance sheet" value={<Money value={data.total} />} icon={Scale} tone="brand" hint={`As of ${formatDate(data.asOf)}, computed lines included`} />
        <StatCard
          label="Entered here, outstanding"
          value={<Money value={data.recordsOutstanding} />}
          icon={ListChecks}
          hint={`${formatNumber(data.recordCount)} ${data.recordCount === 1 ? "record" : "records"}`}
        />
        <StatCard
          label="Overdue"
          value={<Money value={data.overdue} />}
          icon={AlarmClock}
          tone={data.overdue > 0 ? "danger" : "default"}
          hint={`${formatNumber(data.overdueCount)} past the due date`}
        />
      </StatGrid>
      <GroupSectionsView side={side} sections={data.sections} groups={groups} accounts={accounts} lenders={data.lenders} categories={categories} />
      <p className="text-xs text-muted-foreground">
        See also{" "}
        <Link href={copy.other.href} className="font-medium text-brand-ink hover:underline">
          {copy.other.label}
        </Link>
        ,{" "}
        <Link href="/finance/liabilities/loans" className="font-medium text-brand-ink hover:underline">
          Loans & borrowings
        </Link>{" "}
        and the{" "}
        <Link href="/finance/reports/balance-sheet" className="font-medium text-brand-ink hover:underline">
          balance sheet
        </Link>
        .
      </p>
    </Page>
  );
}
