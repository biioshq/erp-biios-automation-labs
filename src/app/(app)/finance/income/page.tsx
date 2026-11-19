import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { getProjectOptions } from "@/server/lookups";
import { getClientNames, listIncome } from "@/features/finance/income/queries";
import { INCOME_FILTER_KEYS, INCOME_SORT_KEYS } from "@/features/finance/income/schemas";
import { IncomeView } from "@/features/finance/income/components/income-view";

export const metadata: Metadata = { title: "Income" };

export default async function IncomePage({ searchParams }: PageProps<"/finance/income">) {
  const params = parseListParams(await searchParams, {
    filterKeys: INCOME_FILTER_KEYS,
    sortable: INCOME_SORT_KEYS,
    defaultSort: { id: "date", desc: true },
  });
  const [data, projects, clients] = await Promise.all([listIncome(params), getProjectOptions(), getClientNames()]);
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Income"
        description={
          <>
            <span className="tabular">{formatNumber(data.summary.count)}</span> {data.summary.count === 1 ? "payment" : "payments"} ·{" "}
            <Money value={data.summary.total} className="font-medium text-foreground" /> received{filtered ? " (filtered)" : ""}
          </>
        }
        actions={
          <Button asChild>
            <Link href="?new=1" scroll={false}>
              <Plus /> Record income
            </Link>
          </Button>
        }
      />
      <IncomeView data={data} projects={projects} clients={clients} />
    </Page>
  );
}
