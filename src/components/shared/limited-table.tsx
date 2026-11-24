"use client";

import { useState } from "react";
import { Table, TableBody } from "@/components/ui/table";
import { RowsPerPage } from "@/components/data-table/rows-per-page";
import { formatNumber } from "@/lib/format";

/**
 * A plain table that shows its first rows, with a "Rows" box under it to show more, all, or a
 * custom number. The footer (totals) always covers every row, not only the ones on screen.
 * Rows come from the server as rendered <TableRow> elements.
 */
export function LimitedTable({
  className,
  header,
  rows,
  footer,
  initialRows = 10,
}: {
  className?: string;
  header: React.ReactNode;
  rows: React.ReactNode[];
  footer?: React.ReactNode;
  initialRows?: number;
}) {
  const [limit, setLimit] = useState<number | null>(initialRows);
  const shown = limit === null ? rows : rows.slice(0, limit);
  return (
    <>
      <Table className={className}>
        {header}
        <TableBody>{shown}</TableBody>
        {footer}
      </Table>
      {rows.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 sm:px-4">
          <p className="tabular text-xs text-muted-foreground">
            Showing {formatNumber(shown.length)} of {formatNumber(rows.length)}
          </p>
          <RowsPerPage value={limit} onChange={setLimit} allowAll />
        </div>
      ) : null}
    </>
  );
}
