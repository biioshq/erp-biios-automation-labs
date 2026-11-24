import Link from "next/link";
import { ArrowUpRight, Banknote, CalendarClock, FileClock, Receipt } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import type { StatementLine } from "@/lib/accounting";
import { formatDate } from "@/lib/format";
import { COMPUTED_SOURCES, type LiabilitySide } from "../groups";
import type { DueItem } from "../types";

/** Where a balance-sheet line of the liabilities side is explained in detail. */
export function liabilityLineHref(key: string, side: LiabilitySide): string {
  if (COMPUTED_SOURCES[key]) return COMPUTED_SOURCES[key].href;
  return `/finance/liabilities/${side === "current_liabilities" ? "current" : "non-current"}#${key}`;
}

/** The balance-sheet lines of one side, with their sub-lines, each linking to where it comes from. */
export function BreakdownList({ lines, side, total }: { lines: StatementLine[]; side: LiabilitySide; total: number }) {
  if (!lines.length) {
    return <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing owed on this side of the balance sheet.</p>;
  }
  return (
    <ul className="divide-y">
      {lines.map((line) => (
        <li key={line.key} className="py-2.5">
          <Link href={liabilityLineHref(line.key, side)} className="group flex items-baseline justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-1 text-sm font-medium group-hover:underline">
              <span className="truncate">{line.label}</span>
              <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
            </span>
            <Money value={line.amount} className="text-sm font-semibold" />
          </Link>
          {line.children?.length ? (
            <ul className="mt-1 space-y-0.5 pl-3">
              {line.children.map((c) => (
                <li key={c.key} className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{c.label}</span>
                  <Money value={c.amount} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
      <li className="flex items-baseline justify-between gap-3 pt-2.5 text-sm font-semibold">
        <span>Total</span>
        <Money value={total} />
      </li>
    </ul>
  );
}

const ITEM_ICON = { loan: Banknote, other: FileClock, bill: Receipt } as const;
const ITEM_LABEL = { loan: "Loan", other: "Liability", bill: "Bill" } as const;

/** Loans, other obligations and bills due, each linking to its record. */
export function DueList({ items, empty }: { items: DueItem[]; empty: { title: string; description: string } }) {
  if (!items.length) return <EmptyState compact icon={CalendarClock} title={empty.title} description={empty.description} />;
  return (
    <ul className="divide-y">
      {items.map((item) => {
        const Icon = ITEM_ICON[item.kind];
        return (
          <li key={item.key}>
            <Link href={item.href} className="flex items-start gap-3 px-1 py-2.5 hover:bg-muted/40">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-surface text-muted-foreground">
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.sub}
                  {item.dueDate ? ` · due ${formatDate(item.dueDate)}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Money value={item.amount} className="block text-sm font-semibold" />
                <StatusBadge tone={item.status === "overdue" ? "danger" : "warning"} className="mt-1 h-5 px-2 text-[11px]">
                  {ITEM_LABEL[item.kind]}
                </StatusBadge>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
