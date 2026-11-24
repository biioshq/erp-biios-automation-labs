import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { ASSET_CONDITIONS, labelOf } from "@/lib/constants";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FooterRow, GridTable, ItemCell, ProjectCell, Qty, type Column } from "@/features/analytics/inventory/components/table-kit";
import { sumOf } from "../model";
import type { EquipmentLine, MaterialLine, PersonLoad, ProjectResources } from "../resource-queries";

/** Tables of the resource utilisation page. Server components. */

const share = (part: number, whole: number) => (whole > 0 ? formatPercent(part / whole) : <span className="text-muted-foreground">None</span>);

export function MaterialsByProjectTable({ rows }: { rows: ProjectResources[] }) {
  const columns: Column<ProjectResources>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.id} name={r.name} code={r.code} color={r.color} /> },
    { key: "status", header: "Status", hideOnPhone: true, cell: (r) => <ProjectStatusBadge status={r.status} /> },
    { key: "assigned", header: "Allocated", align: "right", cell: (r) => <Money value={r.materials.assigned} /> },
    { key: "returned", header: "Returned to storage", align: "right", cell: (r) => <Money value={r.materials.returned} /> },
    { key: "moved", header: "Moved to other projects", align: "right", cell: (r) => <Money value={r.materials.movedOut} /> },
    { key: "wasted", header: "Wasted on site", align: "right", cell: (r) => <Money value={r.materials.wasted} /> },
    { key: "inUse", header: "In use (consumed)", align: "right", cell: (r) => <Money value={r.materials.inUse} className="font-medium" /> },
    { key: "rr", header: "Returned share", align: "right", cell: (r) => share(r.materials.returned, r.materials.assigned) },
    { key: "wr", header: "Wasted share", align: "right", cell: (r) => share(r.materials.wasted, r.materials.assigned) },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      minWidth={1020}
      footer={
        <FooterRow
          cells={[
            { content: "Total" },
            { content: "", className: "hidden sm:table-cell" },
            { content: <Money value={sumOf(rows, (r) => r.materials.assigned)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.materials.returned)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.materials.movedOut)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.materials.wasted)} />, align: "right" },
            { content: <Money value={sumOf(rows, (r) => r.materials.inUse)} />, align: "right" },
            { content: "", span: 2 },
          ]}
        />
      }
    />
  );
}

export function MaterialLinesTable({ rows }: { rows: MaterialLine[] }) {
  const columns: Column<MaterialLine>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.itemId} name={r.name} sku={r.sku} /> },
    { key: "assigned", header: "Allocated", align: "right", cell: (r) => <Qty value={r.assignedQty} unit={r.unit} /> },
    { key: "returned", header: "Returned to storage", align: "right", cell: (r) => <Qty value={r.returnedQty} unit={r.unit} /> },
    { key: "moved", header: "Moved to other projects", align: "right", cell: (r) => <Qty value={r.movedQty} unit={r.unit} /> },
    { key: "wasted", header: "Wasted", align: "right", cell: (r) => <Qty value={r.wastedQty} unit={r.unit} /> },
    { key: "inUse", header: "In use", align: "right", cell: (r) => <Qty value={r.inUseQty} unit={r.unit} className="font-medium" /> },
    { key: "value", header: "Value in use", align: "right", cell: (r) => <Money value={r.inUseValue} /> },
    { key: "last", header: "Last allocated", cell: (r) => (r.lastAssigned ? <span className="whitespace-nowrap">{formatDate(fromDateInput(r.lastAssigned))}</span> : null) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.itemId} minWidth={900} />;
}

type EquipmentRow = EquipmentLine & { projectId: string; projectName: string; color: string };

export function EquipmentTable({ rows, linkAssets }: { rows: EquipmentRow[]; linkAssets: boolean }) {
  const columns: Column<EquipmentRow>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.projectId} name={r.projectName} color={r.color} /> },
    {
      key: "asset",
      header: "Asset",
      cell: (r) => (
        <div className="min-w-0 max-w-64">
          {linkAssets ? (
            <Link href={`/finance/assets/fixed?view=${r.id}`} className="block truncate font-medium hover:underline">
              {r.name}
            </Link>
          ) : (
            <span className="block truncate font-medium">{r.name}</span>
          )}
          <span className="block text-xs text-muted-foreground">
            {r.code}
            {r.isEquipment ? " · Equipment" : ""}
          </span>
        </div>
      ),
    },
    { key: "until", header: "With the project until", cell: (r) => (r.until ? formatDate(fromDateInput(r.until)) : <span className="text-muted-foreground">No end date</span>) },
    { key: "condition", header: "Condition", cell: (r) => labelOf(ASSET_CONDITIONS, r.condition) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={620} />;
}

export function ManpowerByProjectTable({ rows }: { rows: ProjectResources[] }) {
  const columns: Column<ProjectResources>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.id} name={r.name} code={r.code} color={r.color} /> },
    { key: "people", header: "People", align: "right", cell: (r) => formatNumber(r.members.length) },
    { key: "fte", header: "Full-time equivalent", align: "right", cell: (r) => formatNumber(r.fte) },
    {
      key: "members",
      header: "Team and allocation",
      cell: (r) =>
        r.members.length ? (
          <div className="flex max-w-96 flex-wrap gap-1">
            {r.members.map((m) => (
              <Link
                key={m.employeeId}
                href={`/finance/employees/${m.employeeId}`}
                className={cn("rounded-md border px-1.5 py-0.5 text-xs hover:bg-muted", m.totalAllocation > 100 && "border-danger/40 text-danger")}
                title={`${m.role}; ${m.totalAllocation}% across open projects`}
              >
                {m.name} {m.allocation}%
              </Link>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {r.status === "completed" || r.status === "cancelled" ? "Closed: memberships no longer counted" : "No one assigned"}
          </span>
        ),
    },
    { key: "tasks", header: "Open tasks", align: "right", cell: (r) => formatNumber(r.openTasks) },
    { key: "unassigned", header: "Of them unassigned", align: "right", cell: (r) => formatNumber(r.unassignedOpenTasks) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={860} />;
}

export function PeopleLoadTable({ rows }: { rows: PersonLoad[] }) {
  const columns: Column<PersonLoad>[] = [
    {
      key: "name",
      header: "Person",
      cell: (r) => (
        <div className="min-w-0 max-w-56">
          <Link href={`/finance/employees/${r.employeeId}`} className="block truncate font-medium hover:underline">
            {r.name}
          </Link>
          <span className="block truncate text-xs text-muted-foreground">{[r.designation, r.department].filter(Boolean).join(" · ")}</span>
        </div>
      ),
    },
    {
      key: "total",
      header: "Allocated",
      align: "right",
      cell: (r) => (
        <span className={cn("font-medium", r.totalAllocation > 100 ? "text-danger" : r.totalAllocation < 100 ? "text-muted-foreground" : "")}>{r.totalAllocation}%</span>
      ),
    },
    {
      key: "state",
      header: "Load",
      cell: (r) =>
        r.totalAllocation > 100 ? (
          <Badge variant="secondary" className="bg-danger/10 text-danger">
            Over-allocated
          </Badge>
        ) : r.totalAllocation < 100 ? (
          <Badge variant="secondary">{100 - r.totalAllocation}% free</Badge>
        ) : (
          <Badge variant="secondary" className="bg-success/10 text-success">
            Fully allocated
          </Badge>
        ),
    },
    { key: "projects", header: "Projects", cell: (r) => <span className="block max-w-80 text-xs whitespace-normal">{r.projects.map((p) => `${p.name} ${p.allocation}%`).join(", ")}</span> },
    { key: "tasks", header: "Open tasks", align: "right", cell: (r) => formatNumber(r.openTasks) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.employeeId} minWidth={760} />;
}
