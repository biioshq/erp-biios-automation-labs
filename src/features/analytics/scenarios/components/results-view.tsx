import Link from "next/link";
import { CircleSlash, Info, Lightbulb } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { formatCell } from "../format";
import type { Cell, ComparisonRow, ResultTable, ScenarioResults, ValueType } from "../types";
import { ScenarioResultChart } from "./result-chart";

/**
 * A scenario's results: the headline, key figures, current position against the scenario, the
 * detail tables, a chart where it helps, how the figures were worked out and what is not recorded.
 * No hooks, so the detail page renders it on the server and the form's preview on the client.
 */

const numeric = (t: ValueType) => t === "money" || t === "number" || t === "percent";
const tones = { danger: "bg-danger/5", warning: "bg-warning/5" } as const;

function CellText({ type, value, unit, signed }: { type: ValueType; value: Cell; unit?: string; signed?: boolean }) {
  if (value === null || value === "") return <span className="text-muted-foreground">Not known</span>;
  const negative = typeof value === "number" && value < 0;
  return <span className={cn(numeric(type) && "tabular whitespace-nowrap", signed && negative && "text-success", signed && typeof value === "number" && value > 0 && type === "money" && "text-danger")}>{formatCell(type, value, unit, signed)}</span>;
}

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <Table className="min-w-[520px]">
      <TableHeader>
        <TableRow>
          <TableHead>Parameter</TableHead>
          <TableHead className="text-right">Current</TableHead>
          <TableHead className="text-right">Scenario</TableHead>
          <TableHead className="text-right">Difference</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="font-medium">{r.parameter}</TableCell>
            <TableCell className="text-right">{r.current === null && r.type === "percent" && r.key === "change" ? "" : <CellText type={r.type} value={r.current} unit={r.unit} />}</TableCell>
            <TableCell className="text-right">
              <CellText type={r.type} value={r.scenario} unit={r.unit} />
            </TableCell>
            <TableCell className="text-right">{r.difference === null ? <span className="text-muted-foreground">-</span> : <CellText type={r.type} value={r.difference} unit={r.unit} signed />}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ResultTableView({ table }: { table: ResultTable }) {
  if (!table.rows.length) return <EmptyState compact title="Nothing to show" description={table.emptyText ?? "No records match."} />;
  return (
    <Table className={cn(table.columns.length > 5 ? "min-w-[760px]" : "min-w-[420px]")}>
      <TableHeader>
        <TableRow>
          {table.columns.map((c) => (
            <TableHead key={c.key} className={cn(numeric(c.type) && "text-right", "whitespace-nowrap")}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, i) => (
          <TableRow key={i} className={row.tone ? tones[row.tone] : undefined}>
            {table.columns.map((c, ci) => {
              const value = row.cells[c.key] ?? null;
              const href = row.links?.[c.key];
              const content = value === null ? <span className="text-muted-foreground">-</span> : <CellText type={c.type} value={value} unit={c.unit} />;
              return (
                <TableCell key={c.key} className={cn(numeric(c.type) && "text-right", ci === 0 && "font-medium", c.type === "text" && "min-w-32")}>
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
      {table.totals ? (
        <TableFooter>
          <TableRow>
            {table.columns.map((c) => {
              const v = table.totals?.[c.key];
              return (
                <TableCell key={c.key} className={cn(numeric(c.type) && "text-right")}>
                  {v === undefined || v === null ? "" : <CellText type={c.type} value={v} unit={c.unit} />}
                </TableCell>
              );
            })}
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}

export function NotRecordedNote({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed px-4 py-3 text-sm">
      <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">
          {label}: <span className="font-normal text-muted-foreground">not recorded</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function ResultsView({ results }: { results: ScenarioResults }) {
  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <div className="flex items-start gap-3 rounded-xl border border-brand/25 bg-brand/5 px-4 py-3.5 text-sm sm:px-5">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        <p className="text-pretty">{results.headline}</p>
      </div>

      <StatGrid>
        {results.stats.map((s) => (
          <StatCard
            key={s.key}
            label={s.label}
            value={s.value === null ? <span className="text-muted-foreground">Not known</span> : formatCell(s.type, s.value, s.unit)}
            hint={s.hint}
            tone={s.tone === "danger" ? "danger" : s.tone === "warning" ? "warning" : s.tone === "success" ? "success" : "default"}
            className={cn(s.tone === "danger" && "border-danger/30", s.tone === "warning" && "border-warning/30")}
          />
        ))}
      </StatGrid>

      <Section title="Current position vs scenario" description="Current is today's recorded position; scenario is the same measure once the scenario plays out." contentClassName="p-0 sm:p-0">
        <ComparisonTable rows={results.comparison} />
      </Section>

      {results.chart ? (
        <Section title={results.chart.title} description={results.chart.description}>
          <ScenarioResultChart chart={results.chart} />
        </Section>
      ) : null}

      {results.tables.map((t) => (
        <Section key={t.key} title={t.title} description={t.description} contentClassName={t.rows.length ? "p-0 sm:p-0" : undefined}>
          <ResultTableView table={t} />
        </Section>
      ))}

      {results.notes.length ? (
        <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <ul className="min-w-0 space-y-1">
            {results.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {results.notRecorded.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {results.notRecorded.map((n) => (
            <NotRecordedNote key={n.label} label={n.label} detail={n.detail} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
