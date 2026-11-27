import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { formatDateShort, formatNumber } from "@/lib/format";
import type { ColumnRole, StatementLine } from "../types";

/** The first lines as they will be read with the columns picked, to check the mapping before the review. */
export function StatementPreview({ lines, total, mapping }: { lines: StatementLine[]; total: number; mapping: (ColumnRole | null)[] }) {
  if (!lines.length) {
    return <p className="text-sm text-warning">No transactions are read with these columns yet. Check the row with the column names and what each column holds.</p>;
  }
  const vendor = mapping.includes("vendor");
  const reference = mapping.includes("reference");
  const category = mapping.includes("category");
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        First {formatNumber(lines.length)} of {formatNumber(total)} {total === 1 ? "line" : "lines"} as read
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[640px] text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Row</TableHead>
              <TableHead className="w-24">Date</TableHead>
              <TableHead>Narration</TableHead>
              {reference ? <TableHead className="w-36">Ref no</TableHead> : null}
              {vendor ? <TableHead className="w-40">Vendor</TableHead> : null}
              {category ? <TableHead className="w-32">Category</TableHead> : null}
              <TableHead className="w-28 text-right">Withdrawal</TableHead>
              <TableHead className="w-28 text-right">Deposit</TableHead>
              <TableHead className="w-32 text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={`${l.line}-${i}`} className="align-top">
                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{l.line}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatDateShort(l.date)}</TableCell>
                <TableCell className="max-w-[280px]">
                  <p className="line-clamp-2 [overflow-wrap:anywhere]" title={l.narration}>
                    {l.narration || "No narration"}
                  </p>
                </TableCell>
                {reference ? (
                  <TableCell className="font-mono text-xs [overflow-wrap:anywhere]">{l.reference || <span className="text-muted-foreground">-</span>}</TableCell>
                ) : null}
                {vendor ? <TableCell className="[overflow-wrap:anywhere]">{l.vendor ?? <span className="text-muted-foreground">-</span>}</TableCell> : null}
                {category ? <TableCell className="[overflow-wrap:anywhere]">{l.category ?? <span className="text-muted-foreground">-</span>}</TableCell> : null}
                <TableCell className="text-right">{l.withdrawal ? <Money value={l.withdrawal} exact className="text-danger" /> : null}</TableCell>
                <TableCell className="text-right">{l.deposit ? <Money value={l.deposit} exact className="text-success" /> : null}</TableCell>
                <TableCell className="text-right">{l.balance === null ? <span className="text-muted-foreground">-</span> : <Money value={l.balance} exact />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
