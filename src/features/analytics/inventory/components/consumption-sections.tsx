import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/shared/money";
import type { MaterialComparison, ProjectComparison } from "../consumption-queries";
import { Change, GridTable, ItemCell, ProjectCell, Qty, type Column } from "./table-kit";

/** Tables of the consumption trends page. Server components. */

const PATTERN: Record<NonNullable<MaterialComparison["pattern"]>, { label: string; className: string }> = {
  up: { label: "Doubled or more", className: "bg-danger/10 text-danger" },
  down: { label: "Halved or less", className: "bg-warning/12 text-warning" },
  stopped: { label: "Stopped", className: "bg-warning/12 text-warning" },
  new: { label: "New this period", className: "bg-info/10 text-info" },
};

export function PatternBadge({ pattern }: { pattern: MaterialComparison["pattern"] }) {
  if (!pattern) return <span className="text-xs text-muted-foreground">Usual</span>;
  const p = PATTERN[pattern];
  return (
    <Badge variant="secondary" className={p.className}>
      {p.label}
    </Badge>
  );
}

export function MaterialComparisonTable({ rows }: { rows: MaterialComparison[] }) {
  const columns: Column<MaterialComparison>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.itemId} name={r.name} sku={r.sku} /> },
    { key: "current", header: "This period", align: "right", cell: (r) => <Qty value={r.current} unit={r.unit} /> },
    { key: "previous", header: "Previous period", align: "right", cell: (r) => <Qty value={r.previous} unit={r.unit} /> },
    { key: "change", header: "Change", align: "right", cell: (r) => <Change value={r.change} /> },
    { key: "value", header: "Value this period", align: "right", cell: (r) => <Money value={r.currentValue} className="font-medium" /> },
    { key: "pvalue", header: "Value before", align: "right", hideOnPhone: true, cell: (r) => <Money value={r.previousValue} /> },
    { key: "pattern", header: "Pattern", cell: (r) => <PatternBadge pattern={r.pattern} /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.itemId} minWidth={780} />;
}

export function ProjectComparisonTable({ rows }: { rows: ProjectComparison[] }) {
  const columns: Column<ProjectComparison>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.projectId} name={r.name} code={r.code} color={r.color} /> },
    { key: "current", header: "This period", align: "right", cell: (r) => <Money value={r.current} className="font-medium" /> },
    { key: "previous", header: "Previous period", align: "right", cell: (r) => <Money value={r.previous} /> },
    { key: "change", header: "Change", align: "right", cell: (r) => <Change value={r.change} /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.projectId} minWidth={480} />;
}
