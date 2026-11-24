import Link from "next/link";
import { Info } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Small server-rendered building blocks for the analytics tables: a column-driven table that
 * scrolls inside its own box on phones, item and project cells that link to their records, and
 * the note used where the ERP does not record something.
 */

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "right";
  className?: string;
  /** Hidden below the sm breakpoint, for secondary columns. */
  hideOnPhone?: boolean;
};

export function GridTable<T>({
  rows,
  columns,
  rowKey,
  minWidth = 560,
  footer,
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  minWidth?: number;
  footer?: React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  const cls = (c: Column<T>) => cn(c.align === "right" && "text-right", c.hideOnPhone && "hidden sm:table-cell", c.className);
  return (
    <Table style={{ minWidth }}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={cls(c)}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={rowKey(r)} className={rowClassName?.(r)}>
            {columns.map((c) => (
              <TableCell key={c.key} className={cn(cls(c), c.align === "right" && "tabular")}>
                {c.cell(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footer ? <TableFooter>{footer}</TableFooter> : null}
    </Table>
  );
}

/** A footer row: `cells` fill the columns in order; a cell may span several. */
export function FooterRow({ cells }: { cells: { content: React.ReactNode; span?: number; align?: "right"; className?: string }[] }) {
  return (
    <TableRow>
      {cells.map((c, i) => (
        <TableCell key={i} colSpan={c.span} className={cn(c.align === "right" && "tabular text-right", c.className)}>
          {c.content}
        </TableCell>
      ))}
    </TableRow>
  );
}

/** Item name linking to its record, with the SKU under it. */
export function ItemCell({ id, name, sku, archived }: { id: string; name: string; sku?: string; archived?: boolean }) {
  return (
    <div className="min-w-0 max-w-64">
      <Link href={`/inventory/items/${id}`} className="block truncate font-medium hover:underline">
        {name}
      </Link>
      {sku || archived ? (
        <span className="block truncate text-xs text-muted-foreground">
          {sku}
          {archived ? `${sku ? " · " : ""}Archived` : ""}
        </span>
      ) : null}
    </div>
  );
}

/** Project name with its colour, linking to the project page. */
export function ProjectCell({ id, name, code, color }: { id: string; name: string; code?: string; color?: string }) {
  return (
    <div className="flex min-w-0 max-w-64 items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color ?? "#94a3b8" }} aria-hidden />
      <div className="min-w-0">
        <Link href={`/finance/projects/${id}`} className="block truncate font-medium hover:underline">
          {name}
        </Link>
        {code ? <span className="block truncate text-xs text-muted-foreground">{code}</span> : null}
      </div>
    </div>
  );
}

/** A quantity with its unit: "12.5 m". */
export function Qty({ value, unit, className }: { value: number | null | undefined; unit: string; className?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">Not known</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {formatNumber(value)} <span className="text-muted-foreground">{unit}</span>
    </span>
  );
}

/** A signed change as a percentage, coloured; `invert` when a rise is bad. */
export function Change({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-muted-foreground">No earlier use</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("tabular whitespace-nowrap font-medium", value === 0 ? "text-muted-foreground" : good ? "text-success" : "text-danger")}>
      {up ? "+" : "-"}
      {formatPercent(Math.abs(value))}
    </span>
  );
}

/** One note for figures the ERP does not record, instead of a column of blanks. */
export function NotRecorded({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-sm", className)}>
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{title}</p>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** "How this is worked out" text under a section, kept short. */
export function RuleNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs text-pretty text-muted-foreground", className)}>{children}</p>;
}

/** Plural helper: "1 item", "3 items". */
export const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;
