import { Money } from "@/components/shared/money";
import { formatDate, formatPercent } from "@/lib/format";
import type { ProjectForecastRow, SpendPoint } from "../types";
import { ProjectSpendChart } from "./charts";
import { VarianceText, methodText } from "./variance";

function Figure({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="tabular mt-1 text-sm font-semibold">{children}</div>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** One project's forecast: the figures behind it, its spend curve and its main cost categories. */
export function ProjectDetail({ row, points }: { row: ProjectForecastRow; points: SpendPoint[] }) {
  return (
    <div className="space-y-5">
      {row.missing.length ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Missing on this project: {row.missing.join(", ").toLowerCase()}. Add {row.missing.length === 1 ? "it" : "them"} in the project&apos;s Edit form for a fuller forecast.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Figure label="Dates" hint={row.pastEnd ? "Past its planned end, still open" : undefined}>
          {row.startDate ? formatDate(row.startDate) : "No start"} to {row.endDate ? formatDate(row.endDate) : "no end"}
        </Figure>
        <Figure label="Spent to date" hint={row.daysElapsed ? `Over ${row.daysElapsed} days` : undefined}>
          <Money value={row.spent} />
        </Figure>
        <Figure label="Average spend per day" hint={row.dailyRate === null ? row.runRateNote : "Since the start date"}>
          {row.dailyRate === null ? "-" : <Money value={row.dailyRate} />}
        </Figure>
        <Figure label="Days to planned end">{row.daysRemaining === null ? "-" : row.daysRemaining}</Figure>
        <Figure label="Remaining at run rate" hint="Daily rate × days to planned end">
          {row.runRateRemaining === null ? "-" : <Money value={row.runRateRemaining} />}
        </Figure>
        <Figure label="Budget left" hint="Budget less spend, never below 0. Not assumed to be spent">
          <Money value={row.budgetRemaining} />
        </Figure>
        <Figure label="Predicted total cost" hint={row.predictedTotal === null ? row.forecastNote : methodText(row)}>
          {row.predictedTotal === null ? "-" : <Money value={row.predictedTotal} />}
        </Figure>
        <Figure label="Against the budget" hint={row.budget > 0 ? <>Budget <Money value={row.budget} /></> : undefined}>
          <VarianceText row={row} className="whitespace-normal" />
        </Figure>
      </div>

      {points.length ? (
        <ProjectSpendChart points={points} budget={row.budget} />
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No spend or start date recorded, so there is nothing to chart yet.</p>
      )}

      <div>
        <h3 className="text-sm font-semibold">Main cost categories</h3>
        {row.categories.length ? (
          <ul className="mt-3 space-y-2.5">
            {row.categories.slice(0, 6).map((c) => (
              <li key={c.value} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{c.label}</span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    <Money value={c.amount} className="font-medium text-foreground" /> · {formatPercent(c.share)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(2, c.share * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No expenses recorded for this project yet.</p>
        )}
      </div>
    </div>
  );
}
