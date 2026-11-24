import Link from "next/link";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { labelsFor } from "@/features/finance/assets/fixed/labels";
import { methodText } from "@/features/finance/assets/fixed/components/asset-badges";
import type { DepreciationAssetRow, DepreciationFigures, DepreciationGroupRow } from "../types";

const dash = <span className="text-muted-foreground">-</span>;

/**
 * The four figures of a row, right-aligned, in the same order as the column headings. A row that
 * left the books in the period (`closed`) has a charge but no closing figures.
 */
function Figures({ f, strong, closed }: { f: DepreciationFigures; strong?: boolean; closed?: boolean }) {
  return (
    <>
      <TableCell className="text-right">{closed ? dash : <Money value={f.cost} />}</TableCell>
      <TableCell className={cn("text-right", strong && "font-medium")}>
        <Money value={f.charged} />
      </TableCell>
      <TableCell className="text-right text-muted-foreground">{closed ? dash : <Money value={f.accumulated} />}</TableCell>
      <TableCell className={cn("text-right", strong && "font-semibold")}>{closed ? dash : <Money value={f.bookValue} />}</TableCell>
    </>
  );
}

function FigureHeads({ chargeLabel }: { chargeLabel: string }) {
  return (
    <>
      <TableHead className="text-right">Original cost</TableHead>
      <TableHead className="text-right">{chargeLabel}</TableHead>
      <TableHead className="text-right">Accumulated</TableHead>
      <TableHead className="text-right">Book value</TableHead>
    </>
  );
}

/** Per group (subgroups indented under their category), with the total. */
export function GroupTable({ rows, totals, chargeLabel }: { rows: DepreciationGroupRow[]; totals: DepreciationFigures; chargeLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[680px]">
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Assets</TableHead>
            <FigureHeads chargeLabel={chargeLabel} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.kind}-${r.key}`}>
              <TableCell>
                <span className={cn("block", r.depth === 0 ? "font-medium" : "text-muted-foreground")} style={{ paddingLeft: `${Math.min(r.depth, 4) * 14}px` }}>
                  {r.label}
                </span>
              </TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{r.count}</TableCell>
              <Figures f={r} strong={r.depth === 0} />
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right tabular">{totals.count}</TableCell>
            <Figures f={totals} strong />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

/** One line per asset, linked to its record in the register. */
export function AssetTable({ rows, chargeLabel }: { rows: DepreciationAssetRow[]; chargeLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Purchased</TableHead>
            <FigureHeads chargeLabel={chargeLabel} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="min-w-48">
                  <Link href={`${labelsFor(r.kind).href}?view=${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="truncate text-[11px] text-muted-foreground">
                    <span className="font-mono">{r.code}</span> · {r.groupPath.split(" › ").slice(-2).join(" › ")}
                  </p>
                  {r.disposedOn ? (
                    <StatusBadge tone="neutral" dot={false} className="mt-1 h-5 px-2 text-[11px]">
                      Disposed {formatDate(r.disposedOn)}
                    </StatusBadge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{methodText(r.method, r.usefulLifeYears, r.wdvRate)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.purchaseDate)}</TableCell>
              <Figures f={r} closed={Boolean(r.disposedOn)} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
