"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan } from "@/components/current-user";
import { useOnLiveChange } from "@/components/live-updates";
import { formatDateTime } from "@/lib/format";
import type { AuditRow } from "@/lib/audit";
import { fetchAuditHistory } from "../actions";
import { AuditActionBadge, AuditChanges } from "./audit-parts";

/**
 * The History section of a record's drawer: every change the audit trail holds for it, newest
 * first. Shown only to people with the Audit trail permission. Records changed before the audit
 * trail existed show only what happened since.
 */
export function AuditHistory({ type, id, number }: { type: "expense" | "income" | "invoice"; id: string; number: string }) {
  const allowed = useCan("finance.audit:view");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetchAuditHistory(type, id)
      .then((r) => !cancelled && setRows(r ?? []))
      .catch(() => !cancelled && setRows((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [allowed, type, id, version]);

  // A payment recorded or an edit saved elsewhere shows up here too.
  useOnLiveChange(() => setVersion((v) => v + 1));

  if (!allowed) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">History</h3>
        <Link href={`/finance/audit?type=${type}&q=${encodeURIComponent(number)}`} className="text-xs font-medium text-brand-ink hover:underline">
          Open in audit trail
        </Link>
      </div>
      {rows === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <History className="size-4 shrink-0" /> No changes recorded yet. Changes made before the audit trail started are not listed.
        </p>
      ) : (
        <ol className="space-y-3 border-l pl-4">
          {rows.map((r) => (
            <li key={r.id} className="relative space-y-1">
              <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-border ring-2 ring-background" aria-hidden />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <AuditActionBadge action={r.action} label={r.actionLabel} />
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(r.at)} · {r.actor}
                  {r.source !== "manual" ? ` · ${r.sourceLabel}` : ""}
                </span>
              </div>
              <AuditChanges changes={r.changes} />
              {r.note ? <p className="text-xs break-words text-muted-foreground">{r.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
