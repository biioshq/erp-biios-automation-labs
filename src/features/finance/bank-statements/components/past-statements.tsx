import Link from "next/link";
import { FileClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StatementRow } from "../types";

const period = (s: StatementRow) => (s.from && s.to ? (s.from === s.to ? formatDate(s.from) : `${formatDate(s.from)} to ${formatDate(s.to)}`) : "No dates");

/** Account chips over the list: all accounts, or one. */
export function AccountFilter({ accounts, current }: { accounts: { value: string; label: string }[]; current: string | null }) {
  if (accounts.length < 2) return null;
  const chip = (href: string, label: string, on: boolean) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      className={cn("inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors max-md:h-10", on ? "border-brand/40 bg-brand/10 text-brand-ink" : "hover:bg-muted")}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {chip("/finance/bank-statements", "All accounts", !current)}
      {accounts.map((a) => chip(`/finance/bank-statements?account=${a.value}`, a.label, current === a.value))}
    </div>
  );
}

/** Statements uploaded before, newest first, each opening its lines and the records they became. */
export function PastStatements({ rows }: { rows: StatementRow[] }) {
  if (!rows.length) {
    return <EmptyState compact icon={FileClock} title="No statements added yet" description="Statements you add appear here with their period and what each line became." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">Added</TableHead>
            <TableHead className="text-right">Matched</TableHead>
            <TableHead className="text-right">Ignored</TableHead>
            <TableHead className="text-right">Closing balance</TableHead>
            <TableHead>Uploaded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <Link href={`/finance/bank-statements/${s.id}`} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                  {period(s)}
                </Link>
                {s.fileName ? <p className="max-w-64 truncate text-xs text-muted-foreground">{s.fileName}</p> : null}
              </TableCell>
              <TableCell>{s.accountName}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(s.lines)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(s.added)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(s.matched)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(s.ignored)}</TableCell>
              <TableCell className="text-right">{s.closingBalance === null ? <span className="text-muted-foreground">Not shown</span> : <Money value={s.closingBalance} exact />}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDateTime(s.createdAt)}
                {s.createdBy ? ` by ${s.createdBy}` : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
