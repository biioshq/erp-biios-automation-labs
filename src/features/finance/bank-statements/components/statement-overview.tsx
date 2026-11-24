import { ArrowDownLeft, ArrowUpRight, CalendarRange, Scale } from "lucide-react";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber } from "@/lib/format";
import type { ParsedStatement } from "../types";

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** What the statement says in total, and how its lines held up against the running balance. */
export function StatementOverview({ statement, bank }: { statement: ParsedStatement; bank: string | null }) {
  const s = statement;
  const deposits = s.lines.filter((l) => l.deposit > 0).length;
  const withdrawals = s.lines.length - deposits;
  const checked = s.lines.length - s.unchecked;
  return (
    <div className="space-y-3">
      <StatGrid>
        <StatCard
          compact
          label="Statement period"
          icon={CalendarRange}
          value={<span className="text-base sm:text-lg">{s.from && s.to ? (s.from === s.to ? formatDate(s.from) : `${formatDate(s.from)} to ${formatDate(s.to)}`) : "No lines"}</span>}
          hint={[bank, plural(s.lines.length, "line", "lines")].filter(Boolean).join(" · ")}
        />
        <StatCard
          compact
          label="Opening and closing balance"
          icon={Scale}
          value={
            <span className="text-base sm:text-lg">
              {s.opening === null ? "Not shown" : <Money value={s.opening} exact />}
              <span className="text-muted-foreground"> to </span>
              {s.closing === null ? "Not shown" : <Money value={s.closing} exact />}
            </span>
          }
          hint={s.opening === null ? "The statement prints no balance" : s.openingStated ? "Opening balance as printed" : "Opening worked out from the first line"}
        />
        <StatCard compact label="Deposits" icon={ArrowDownLeft} tone="success" value={<Money value={s.totalDeposits} exact />} hint={plural(deposits, "deposit", "deposits")} />
        <StatCard compact label="Withdrawals" icon={ArrowUpRight} tone="danger" value={<Money value={s.totalWithdrawals} exact />} hint={plural(withdrawals, "withdrawal", "withdrawals")} />
      </StatGrid>
      <p className="text-sm text-muted-foreground">
        {checked > 0
          ? `${plural(checked - s.mismatches, "line", "lines")} of ${formatNumber(checked)} with a balance add up to the paisa.`
          : "No line could be checked against a running balance."}
        {s.fixed ? ` ${plural(s.fixed, "line was", "lines were")} on the wrong side and turned round by the balance.` : ""}
        {s.mismatches ? ` ${plural(s.mismatches, "line does", "lines do")} not reconcile with the balance: check ${s.mismatches === 1 ? "it" : "them"} in the review.` : ""}
        {s.newestFirst ? " The file lists the newest line first; it is read oldest first." : ""}
      </p>
      {s.skipped.length ? (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">{plural(s.skipped.length, "row was", "rows were")} not read as a transaction</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-muted-foreground">
            {s.skipped.map((r) => (
              <li key={r.line}>
                Row {r.line}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
