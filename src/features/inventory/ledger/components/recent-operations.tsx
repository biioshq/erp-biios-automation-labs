import Link from "next/link";
import { History } from "lucide-react";
import { Section } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { PROJECT_STAGES, labelOf, type MovementType } from "@/lib/constants";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import type { RecentOperation } from "../types";

/** The last few operations of one type, with a link to the full history. */
export function RecentOperations({
  title,
  operations,
  type,
  emptyText,
}: {
  title: string;
  operations: RecentOperation[];
  type: MovementType;
  emptyText: string;
}) {
  return (
    <Section
      title={title}
      description="Most recent first"
      actions={
        <Link href={`/inventory/movements?type=${type}`} className="inline-flex min-h-8 items-center text-xs font-medium text-brand-ink hover:underline">
          View all
        </Link>
      }
      contentClassName="p-0"
    >
      {operations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground">
            <History className="size-4" />
          </span>
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {operations.map((op) => (
            <li key={op.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
              <div className="min-w-0 max-w-full">
                <Link href={`/inventory/items/${op.item.id}`} className="block truncate text-sm font-medium hover:underline">
                  {op.item.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {op.project ? (
                    <>
                      <span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ background: op.project.color }} />
                      {op.project.name}
                      {op.stage ? ` · ${labelOf(PROJECT_STAGES, op.stage)}` : ""}
                    </>
                  ) : (
                    (op.vendor ?? op.item.sku)
                  )}
                  {op.by ? ` · ${op.by}` : ""}
                </p>
              </div>
              <div className="tabular flex items-baseline gap-4 text-right text-sm">
                <span className="font-semibold">
                  {formatNumber(op.quantity)} {op.item.unit}
                </span>
                <Money value={op.totalCost} className="text-muted-foreground sm:w-24" />
                <time dateTime={op.date} title={formatDate(op.date)} className="hidden w-24 text-xs text-muted-foreground sm:block">
                  {formatRelative(op.date)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
