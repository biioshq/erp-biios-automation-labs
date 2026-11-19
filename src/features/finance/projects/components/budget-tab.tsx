import { PiggyBank, Receipt, Wallet } from "lucide-react";
import { Money } from "@/components/shared/money";
import { ResponsiveMoney } from "@/features/finance/dashboard/components/responsive-money";
import { Section } from "@/components/shared/page";
import { StatCard } from "@/components/shared/stat-card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { BUDGET_TEXT_CLASS, budgetTone } from "../utils";
import { stageRows } from "../queries";
import type { ProjectDetail } from "../types";
import { BudgetBar } from "./project-budget-bar";
import { StageChart } from "./stage-chart";

/** Tighter tiles on phones so two fit across at 360px. */
const KPI = "max-sm:p-4 max-sm:[&>.tabular]:text-xl";

export function BudgetTab({ project }: { project: ProjectDetail }) {
  const rows = stageRows(project);
  const tone = budgetTone(project.usage, project.budget);
  const planned = rows.reduce((s, r) => s + r.planned, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard className={KPI} label="Total budget" value={<ResponsiveMoney value={project.budget} />} icon={Wallet} tone="info" hint={planned > 0 ? `${formatPercent(project.budget > 0 ? planned / project.budget : 0)} planned by stage` : "No stage budgets set"} />
        <StatCard className={KPI} label="Total spent" value={<ResponsiveMoney value={project.spent} />} icon={Receipt} tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "brand"} hint={project.budget > 0 ? `${formatPercent(project.usage)} of budget` : undefined} footer={<BudgetBar spent={project.spent} budget={project.budget} />} />
        <StatCard
          className={`${KPI} max-sm:col-span-2`}
          label="Remaining budget"
          value={<ResponsiveMoney value={project.remaining} tone={project.remaining < 0 ? "negative" : undefined} />}
          icon={PiggyBank}
          tone={project.remaining < 0 ? "danger" : "success"}
          hint={project.remaining < 0 ? "Over budget" : undefined}
        />
      </div>

      <Section title="Stage-wise spending" description="Planned stage budget against what has been spent. Inventory assignments count in the stage they were assigned to.">
        <StageChart rows={rows} showPlanned={planned > 0} />
      </Section>

      <Section title="By stage" contentClassName="p-0">
        <ul className="divide-y md:hidden">
          {rows.map((r) => (
            <li key={r.stage} className="space-y-1.5 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{r.label}</span>
                <Money value={r.spent} className="shrink-0 font-semibold" />
              </div>
              <div className="flex items-center gap-2" aria-hidden>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${r.share * 100}%` }} />
                </div>
                <span className="tabular w-10 shrink-0 text-right text-xs text-muted-foreground">{formatPercent(r.share)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {r.planned > 0 ? (
                  <>
                    Planned <Money value={r.planned} />
                    {r.variance !== null ? (
                      <span className={r.variance < 0 ? "text-danger" : "text-success"}>
                        {" · "}
                        {r.variance < 0 ? "over by " : "under by "}
                        <Money value={Math.abs(r.variance)} />
                      </span>
                    ) : null}
                  </>
                ) : (
                  "No stage budget set"
                )}
              </p>
            </li>
          ))}
        </ul>
        <div className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Stage</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="min-w-40 pr-5">Share of spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.stage}>
                <TableCell className="pl-5 font-medium">{r.label}</TableCell>
                <TableCell className="text-right">{r.planned > 0 ? <Money value={r.planned} /> : <span className="text-muted-foreground">Not set</span>}</TableCell>
                <TableCell className="text-right">
                  <Money value={r.spent} className="font-medium" />
                </TableCell>
                <TableCell className="text-right">
                  {r.variance === null ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <span className={cn("tabular", r.variance < 0 ? "text-danger" : "text-success")}>
                      {r.variance < 0 ? "Over by " : "Under by "}
                      <Money value={Math.abs(r.variance)} />
                    </span>
                  )}
                </TableCell>
                <TableCell className="pr-5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-chart-1" style={{ width: `${r.share * 100}%` }} />
                    </div>
                    <span className={cn("tabular w-12 text-right text-xs", r.share > 0 ? "text-foreground" : BUDGET_TEXT_CLASS.ok)}>{formatPercent(r.share)}</span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-5 font-semibold">Total</TableCell>
              <TableCell className="text-right">
                <Money value={planned} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                <Money value={rows.reduce((s, r) => s + r.spent, 0)} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                {planned > 0 ? (
                  <Money value={planned - rows.reduce((s, r) => s + r.spent, 0)} tone="auto" className="font-semibold" />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="pr-5" />
            </TableRow>
          </TableFooter>
        </Table>
        </div>
        {rows.reduce((s, r) => s + r.spent, 0) < project.spent ? (
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            <Money value={project.spent - rows.reduce((s, r) => s + r.spent, 0)} /> of spend has no stage and is not shown above.
          </p>
        ) : null}
      </Section>
    </div>
  );
}
