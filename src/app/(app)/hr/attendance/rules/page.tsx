import type { Metadata } from "next";
import { Info } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { NoAccess } from "@/components/shared/no-access";
import { formatDateTime } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { todayIST } from "@/features/hr/server";
import { getRulesPageData } from "@/features/hr/rules/queries";
import { RulesForm } from "@/features/hr/rules/components/rules-form";
import { HolidaysPanel } from "@/features/hr/rules/components/holidays-panel";

export const metadata: Metadata = { title: "Attendance rules" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The holidays year from ?year=, or this year in India. */
function yearFrom(value: string | undefined, fallback: number): number {
  if (!value || !/^\d{4}$/.test(value)) return fallback;
  const year = Number(value);
  return year >= 2000 && year <= 2100 ? year : fallback;
}

export default async function AttendanceRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "hr.settings:view")) return <NoAccess eyebrow="HR" title="Attendance rules" />;
  const canEdit = can(user, "hr.settings:edit");
  const sp = await searchParams;
  const thisYear = Number(todayIST().slice(0, 4));
  const year = yearFrom(first(sp.year), thisYear);
  const data = await getRulesPageData(year);

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="Attendance rules"
        description={
          canEdit
            ? "Office hours, weekly offs, leave types, holidays and how salary is worked out from attendance."
            : "Office hours, weekly offs, leave types, holidays and how salary is worked out from attendance. Your role can read these but not change them."
        }
      />

      {!data.saved ? (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-info/25 bg-info/5 px-3.5 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="min-w-0 text-pretty">
            <span className="font-medium">These are the default rules.</span>{" "}
            <span className="text-muted-foreground">
              They are in use until someone saves the rules{canEdit ? " below" : ""}. Check them before marking attendance or working out salaries.
            </span>
          </p>
        </div>
      ) : data.updatedAt ? (
        <p className="-mt-2 text-xs text-muted-foreground">Last saved {formatDateTime(data.updatedAt)}</p>
      ) : null}

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1fr)_400px] 2xl:items-start">
        <RulesForm rules={data.rules} saved={data.saved} leaveUsage={data.leaveUsage} canEdit={canEdit} />
        <HolidaysPanel
          year={data.year}
          thisYear={thisYear}
          holidays={data.holidays}
          lockedMonths={data.lockedMonths}
          weeklyOffs={data.rules.weeklyOffs}
          offSaturdays={data.rules.offSaturdays}
          canEdit={canEdit}
        />
      </div>
    </Page>
  );
}
