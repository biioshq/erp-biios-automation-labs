"use client";

import Link from "next/link";
import { CircleCheck, Download, Package, ReceiptText, RotateCcw } from "lucide-react";
import { useCan } from "@/components/current-user";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AddLineResult, ReviewLine } from "../types";

export type NotAdded = { line: ReviewLine; reason: string };
/** A new expense in category Equipment, which may belong on the asset register. */
export type AssetCandidate = { id: string; label: string; line: number };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** What adding did, line by line: records made, records tied, lines ignored, and what was left out and why. */
export function AddResult({
  results,
  notAdded,
  assets = [],
  statementId,
  onDownload,
  onReset,
}: {
  results: AddLineResult[];
  notAdded: NotAdded[];
  assets?: AssetCandidate[];
  statementId: string | null;
  onDownload: () => void;
  onReset: () => void;
}) {
  const count = (s: AddLineResult["status"]) => results.filter((r) => r.status === s).length;
  const added = count("added");
  const matched = count("matched");
  const ignored = count("ignored");
  const done = results.filter((r) => r.href && (r.status === "added" || r.status === "matched"));
  const any = added + matched + ignored > 0;
  const followUps = results.filter((r) => r.note && r.status === "added");
  const canAddAssets = useCan("finance.fixed_assets:create");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border bg-surface/40 p-4">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full border", any ? "border-success/30 bg-success/10" : "bg-muted")}>
          <CircleCheck className={cn("size-5", any ? "text-success" : "text-muted-foreground")} />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{any ? "Statement added to the books" : "Nothing new was added"}</p>
          <p className="text-sm text-muted-foreground">
            {plural(added, "new record", "new records")} added, {plural(matched, "line", "lines")} tied to records already in the books, {plural(ignored, "line", "lines")} ignored.
            {notAdded.length ? ` ${plural(notAdded.length, "line was", "lines were")} not added (listed below).` : ""}
          </p>
        </div>
      </div>

      {notAdded.length ? (
        <div className="max-h-80 overflow-auto rounded-lg border">
          <ul className="divide-y text-sm">
            {notAdded.map(({ line, reason }) => (
              <li key={line.hash} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">Row {line.line}</span>
                <StatusBadge tone={/^(Imported|Already)/.test(reason) ? "neutral" : "warning"}>{/^(Imported|Already)/.test(reason) ? "Already in" : "Not added"}</StatusBadge>
                <span className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">
                  {line.narration.slice(0, 80)}
                  <span className="text-muted-foreground"> · {reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {followUps.length ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <ReceiptText className="size-4 text-muted-foreground" aria-hidden />
            Receipts and invoices
          </p>
          <ul className="space-y-1">
            {followUps.map((r) => (
              <li key={r.hash} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">Row {r.line}</span>
                <span className={cn("min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]", r.note!.startsWith("Not linked") && "text-warning")}>
                  {r.href ? (
                    <Link href={r.href} className="text-brand-ink underline-offset-2 hover:underline">
                      {r.label}
                    </Link>
                  ) : null}
                  {r.href ? " · " : ""}
                  {r.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {assets.length && canAddAssets ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Package className="size-4 text-muted-foreground" aria-hidden />
            {assets.length === 1 ? "One new expense is equipment" : `${formatNumber(assets.length)} new expenses are equipment`}
          </p>
          <p className="text-muted-foreground">
            Equipment that lasts belongs on the asset register, where it depreciates. Adding it there links the expense, so its cost is not counted twice.
          </p>
          <ul className="space-y-1">
            {assets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-muted-foreground">Row {a.line}</span>
                <span className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">{a.label}</span>
                <Link href={`/finance/assets/fixed?new=1&expense=${a.id}`} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                  Add to asset register
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {done.length ? (
        <details className="rounded-lg border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Records added or tied ({formatNumber(done.length)})</summary>
          <ul className="mt-2 max-h-72 space-y-1 overflow-auto">
            {done.map((r) => (
              <li key={r.hash} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-xs text-muted-foreground">Row {r.line}</span>
                <Link href={r.href!} className="text-brand-ink underline-offset-2 hover:underline [overflow-wrap:anywhere]">
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {statementId ? (
          <Button asChild>
            <Link href={`/finance/bank-statements/${statementId}`}>Open this statement</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/finance/expenses">Expenses</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/finance/income">Income</Link>
        </Button>
        {notAdded.length ? (
          <Button type="button" variant="outline" onClick={onDownload}>
            <Download />
            Lines not added ({formatNumber(notAdded.length)})
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onReset}>
          <RotateCcw />
          Upload another statement
        </Button>
      </div>
    </div>
  );
}
