import { CircleCheck, Clock, Gauge, PiggyBank, Receipt, Wallet } from "lucide-react";
import { Money } from "@/components/shared/money";
import { ResponsiveMoney } from "@/features/finance/dashboard/components/responsive-money";
import { Section } from "@/components/shared/page";
import { StatCard } from "@/components/shared/stat-card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate, formatPercent, round2 } from "@/lib/format";
import { BUDGET_TEXT_CLASS, budgetTone } from "../utils";
import { stageRows } from "../queries";
import type { ProjectDetail } from "../types";
import { BudgetBar, PaidOwedLegend } from "./project-budget-bar";
import { EditBudgetButton } from "./edit-budget-dialog";
import { StageChart } from "./stage-chart";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";

/** Tighter tiles on phones so two fit across at 360px. */
const KPI = "max-sm:p-4 max-sm:[&>.tabular]:text-xl";

export function BudgetTab({ project }: { project: ProjectDetail }) {
  const rows = stageRows(project);
  const tone = budgetTone(project.usage, project.budget);
  // Rounded once so float drift (100.1 + 200.2) never shows a false "no stage" remainder.
  const planned = round2(rows.reduce((s, r) => s + r.planned, 0));
  const stagedTotal = round2(rows.reduce((s, r) => s + r.spent, 0));
  const unstaged = round2(project.spent - stagedTotal);
  const stagedPaid = round2(rows.reduce((s, r) => s + r.paid, 0));
  const pay = project.finance.payables;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          className={KPI}
          label="Allocated budget"
          value={<ResponsiveMoney value={project.budget} />}
          icon={Wallet}
          tone="info"
          hint={
            project.budgetHistory.length ? (
              <>
                Original <Money value={project.originalBudget} compact />, revised {project.budgetHistory.length} {project.budgetHistory.length === 1 ? "time" : "times"}
              </>
            ) : planned > 0 ? (
              `${formatPercent(project.budget > 0 ? planned / project.budget : 0)} planned by stage`
            ) : (
              "Never revised"
            )
          }
        />
        <StatCard
          className={KPI}
          label="Total incurred"
          value={<ResponsiveMoney value={project.spent} />}
          icon={Receipt}
          tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "brand"}
          hint="Every expense, paid or not"
        />
        <StatCard className={KPI} label="Paid" value={<ResponsiveMoney value={pay.paid} />} icon={CircleCheck} tone="success" hint="Paid to vendors" />
        <StatCard
          className={KPI}
          label="Outstanding payables"
          value={<ResponsiveMoney value={pay.outstanding} />}
          icon={Clock}
          tone={pay.overdue > 0 ? "danger" : pay.outstanding > 0 ? "warning" : "success"}
          hint={pay.overdue > 0 ? <><Money value={pay.overdue} compact /> overdue</> : pay.outstanding > 0 ? "Still to pay vendors" : "Nothing owed"}
        />
        <StatCard
          className={KPI}
          label="Remaining budget"
          value={<ResponsiveMoney value={project.remaining} tone={project.remaining < 0 ? "negative" : undefined} />}
          icon={PiggyBank}
          tone={project.remaining < 0 ? "danger" : "success"}
          hint={project.remaining < 0 ? "Over budget" : "Budget minus incurred"}
        />
        <StatCard
          className={KPI}
          label="Utilisation"
          value={project.budget > 0 ? formatPercent(project.usage) : "-"}
          icon={Gauge}
          tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "info"}
          hint={project.budget > 0 ? "Incurred divided by the budget" : "No budget set"}
        />
      </div>
      <SalariesHiddenNote className="-mt-3" />

      <Section
        title="Budget against spend"
        description="Each expense counts once at its full amount. Paying a bill moves it from outstanding to paid; the total stays the same."
        actions={<EditBudgetButton project={{ id: project.id, name: project.name, budget: project.budget, spent: project.spent }} variant="button" />}
      >
        <BudgetSplit budget={project.budget} spent={project.spent} paid={pay.paid} outstanding={pay.outstanding} />
      </Section>

      <BudgetHistory project={project} />

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
              {r.spent > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Paid <Money value={r.paid} /> · <Money value={r.outstanding} /> outstanding
                </p>
              ) : null}
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
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
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
                  <Money value={r.paid} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={r.outstanding} className={r.outstanding > 0 ? undefined : "text-muted-foreground"} />
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
                <Money value={stagedTotal} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                <Money value={stagedPaid} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                <Money value={round2(stagedTotal - stagedPaid)} className="font-semibold" />
              </TableCell>
              <TableCell className="text-right">
                {planned > 0 ? (
                  <Money value={round2(planned - stagedTotal)} tone="auto" className="font-semibold" />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="pr-5" />
            </TableRow>
          </TableFooter>
        </Table>
        </div>
        {unstaged >= 0.01 ? (
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            <Money value={unstaged} /> of spend has no stage and is not shown above.
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/** Every budget change, oldest first: the budget before and after, when, by whom and why. */
function BudgetHistory({ project }: { project: ProjectDetail }) {
  const changes = project.budgetHistory.map((h, i) => ({
    ...h,
    after: project.budgetHistory[i + 1]?.budget ?? project.budget,
  }));
  return (
    <Section title="Budget history" description="The original budget and every revision. Older entries are never changed.">
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The budget has not been revised since the project was created. When you change it with Edit, the earlier figure is kept here.
        </p>
      ) : (
        <ol className="divide-y">
          {changes.map((c, i) => {
            const diff = round2(c.after - c.budget);
            return (
              <li key={`${c.changedAt}-${i}`} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm">
                    <Money value={c.budget} /> <span className="text-muted-foreground">to</span> <Money value={c.after} className="font-medium" />{" "}
                    <span className={cn("text-xs", diff > 0 ? "text-warning" : "text-success")}>
                      ({diff > 0 ? "+" : "-"}
                      <Money value={Math.abs(diff)} />)
                    </span>
                  </p>
                  {c.note ? <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p> : null}
                </div>
                <p className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(c.changedAt)}
                  {c.changedBy ? ` by ${c.changedBy}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

/**
 * One bar against the budget: paid, then outstanding, then the budget not used yet. Over budget the
 * bar is full and the overrun is named below it.
 */
function BudgetSplit({ budget, spent, paid, outstanding }: { budget: number; spent: number; paid: number; outstanding: number }) {
  const over = budget > 0 ? round2(spent - budget) : 0;
  const left = budget > 0 ? Math.max(0, round2(budget - spent)) : 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p className="tabular">
          <Money value={spent} className="text-lg font-semibold tracking-tight" />
          <span className="text-muted-foreground"> incurred of </span>
          <Money value={budget} className="text-muted-foreground" />
        </p>
        <p className="text-xs text-muted-foreground">{budget > 0 ? `${formatPercent(spent / budget)} used` : "No budget set"}</p>
      </div>
      <BudgetBar spent={spent} budget={budget} paid={paid} className="h-3" />
      <PaidOwedLegend />
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Paid</dt>
          <dd className="mt-0.5 font-medium">
            <Money value={paid} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Outstanding</dt>
          <dd className="mt-0.5 font-medium">
            <Money value={outstanding} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{over > 0 ? "Over budget" : "Budget left"}</dt>
          <dd className={cn("mt-0.5 font-medium", over > 0 && "text-danger")}>
            <Money value={over > 0 ? over : left} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Allocated</dt>
          <dd className="mt-0.5 font-medium">
            <Money value={budget} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
