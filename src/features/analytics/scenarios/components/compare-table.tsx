import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatCell } from "../format";
import type { CompareColumn, CompareRow } from "../compare";
import { ScenarioStatusBadge, ScenarioTypeBadge } from "./badges";

function Value({ row, value }: { row: CompareRow; value: CompareRow["current"] }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">None</span>;
    return (
      <ul className="space-y-1 text-left text-xs">
        {value.map((v, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">
            {v}
          </li>
        ))}
      </ul>
    );
  }
  if (value === null) {
    return (
      <span className="text-muted-foreground" title="Does not apply to this type of scenario">
        -
      </span>
    );
  }
  const worse = row.lowerIsBetter && typeof value === "number" && value > 0 && row.group === "impact";
  return <span className={cn("tabular whitespace-nowrap", worse && "text-warning")}>{formatCell(row.type === "list" ? "text" : row.type, value)}</span>;
}

function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={span} className="py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </TableCell>
    </TableRow>
  );
}

/** Current business position and each scenario side by side. */
export function CompareTable({ columns, rows }: { columns: CompareColumn[]; rows: CompareRow[] }) {
  const span = columns.length + 2;
  const render = (group: CompareRow["group"]) =>
    rows
      .filter((r) => r.group === group)
      .map((r) => (
        <TableRow key={`${group}-${r.key}`}>
          <TableCell className="sticky left-0 z-[1] min-w-48 bg-card font-medium">{r.label}</TableCell>
          <TableCell className={cn("align-top", r.type !== "list" && "text-right")}>
            <Value row={r} value={r.current} />
          </TableCell>
          {r.values.map((v, i) => (
            <TableCell key={columns[i].id} className={cn("align-top", r.type !== "list" && "text-right")}>
              <Value row={r} value={v} />
            </TableCell>
          ))}
        </TableRow>
      ));

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-[1] bg-card align-bottom">Measure</TableHead>
          <TableHead className="min-w-36 text-right align-bottom">Current business position</TableHead>
          {columns.map((c) => (
            <TableHead key={c.id} className="min-w-44 py-3 text-right align-bottom whitespace-normal">
              <div className="flex flex-col items-end gap-1">
                <Link href={`/analytics/scenarios/${c.id}`} className="font-semibold text-foreground hover:underline">
                  {c.name}
                </Link>
                <span className="font-mono text-[11px] font-normal">{c.code}</span>
                <div className="flex flex-wrap justify-end gap-1">
                  <ScenarioTypeBadge type={c.type} className="h-5 px-2 text-[11px]" />
                  <ScenarioStatusBadge status={c.status} className="h-5 px-2 text-[11px]" />
                </div>
                <span className="text-[11px] font-normal">{c.basis === "saved" && c.savedAt ? `As saved ${formatDateTime(c.savedAt)}` : "Today's data"}</span>
                {c.error ? <span className="text-[11px] font-normal text-danger">{c.error}</span> : null}
              </div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <GroupRow label="Scenario impact (change from today)" span={span} />
        {render("impact")}
        <GroupRow label="Business position" span={span} />
        {render("position")}
      </TableBody>
    </Table>
  );
}
