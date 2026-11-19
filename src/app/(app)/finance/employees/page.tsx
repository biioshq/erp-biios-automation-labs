import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Building2, Plus, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { EMPLOYEE_FILTER_KEYS } from "@/features/employees/schemas";
import { getEmployeeSummary, getUserLinkOptions, hasEmployees, listEmployees } from "@/features/employees/queries";
import { EmployeesView } from "@/features/employees/components/employees-view";

export const metadata: Metadata = { title: "Employees" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmployeesPage({ searchParams }: PageProps<"/finance/employees">) {
  const sp = await searchParams;
  const params = parseListParams(sp, { filterKeys: EMPLOYEE_FILTER_KEYS });
  const needsUsers = Boolean(first(sp.new) || first(sp.edit));
  const [rows, summary, any, users] = await Promise.all([
    listEmployees(params),
    getEmployeeSummary(),
    hasEmployees(),
    needsUsers ? getUserLinkOptions() : Promise.resolve([]),
  ]);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Employees"
        description="Who works here, which projects they are on and what the team costs each month."
        actions={
          any ? (
            <Button asChild className="w-full sm:w-auto">
              <Link href="?new=1" scroll={false}>
                <Plus /> Add employee
              </Link>
            </Button>
          ) : null
        }
      />

      {any ? (
        <StatGrid className={`grid-cols-2 gap-3 sm:gap-4 ${summary.payroll === null ? "xl:grid-cols-3" : ""}`}>
          <StatCard
            label="Headcount"
            icon={Users}
            tone="brand"
            value={formatNumber(summary.headcount)}
            hint={summary.onLeave ? `${summary.onLeave} on leave` : "Active people"}
            className="p-4 sm:p-5"
          />
          <StatCard
            label="On projects now"
            icon={Briefcase}
            tone="info"
            value={formatNumber(summary.onProjects)}
            hint={summary.headcount ? `of ${formatNumber(summary.headcount)} people` : undefined}
            className="p-4 sm:p-5"
          />
          {summary.payroll !== null ? (
            <StatCard
              label="Monthly payroll"
              icon={Wallet}
              tone="success"
              value={<Money value={summary.payroll} compact />}
              hint="Active salaries"
              className="p-4 sm:p-5"
            />
          ) : null}
          <StatCard
            label="Departments"
            icon={Building2}
            value={formatNumber(summary.departments)}
            hint="With active people"
            className="p-4 sm:p-5"
          />
        </StatGrid>
      ) : null}

      <EmployeesView rows={rows} users={users} hasAny={any} />
    </Page>
  );
}
