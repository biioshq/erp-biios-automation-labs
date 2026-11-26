"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCan } from "@/components/current-user";
import type { AddLinesInput } from "../schemas";
import type { LineDecision, StoredLine, StoredLineReview } from "../types";
import { addStatementBatch, reviewStoredLine, unmatchStatementLine } from "../actions";
import { decisionProblem, toWire, wireDecision } from "../review-state";
import { lineKindLabel } from "../kinds";
import { ActionBadge } from "./line-badges";
import { LineEditor } from "./line-editor";

/** What the add action needs to know about the statement when a line is added again on its page. */
export type StatementHeader = AddLinesInput["statement"] & { id: string };

type Loaded = { review: StoredLineReview; decision: LineDecision };

/**
 * The lines a past statement added, each with the record it became. People with the edit permission
 * can unmatch a line from its record; with create, review and add again a line that is unmatched or
 * whose record was deleted.
 * `focus` is the line opened by a link (?line=<id>): scrolled to and highlighted.
 */
export function StoredLinesTable({ lines, statement, focus }: { lines: StoredLine[]; statement: StatementHeader; focus?: string | null }) {
  const router = useRouter();
  const canUnmatch = useCan("finance.bank_statements:edit");
  const canAdd = useCan("finance.bank_statements:create");
  const [unmatching, setUnmatching] = useState<StoredLine | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`line-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  if (!lines.length) {
    return <EmptyState compact title="No lines were added from this statement" description="Every line was already imported from an earlier upload." />;
  }

  async function review(line: StoredLine) {
    setChecking(line.id);
    try {
      const res = await reviewStoredLine({ id: line.id });
      if (res.ok) setLoaded({ review: res.data, decision: res.data.line.suggestion });
      else toast.error(res.error);
    } catch {
      toast.error("The line could not be checked against the books. Check your connection and try again.");
    } finally {
      setChecking(null);
    }
  }

  async function unmatch(line: StoredLine) {
    const res = await unmatchStatementLine({ id: line.id });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (res.data.status === "unmatched") toast.success(res.data.message);
    else toast.info(res.data.message);
    router.refresh();
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Date</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead className="w-32 text-right">Withdrawal</TableHead>
              <TableHead className="w-32 text-right">Deposit</TableHead>
              <TableHead className="w-36 text-right">Balance</TableHead>
              <TableHead className="w-80">Became</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow
                key={l.id}
                id={`line-${l.id}`}
                aria-current={focus === l.id ? "true" : undefined}
                className={cn("scroll-mt-24 align-top", focus === l.id && "bg-brand/10 ring-2 ring-brand/40 ring-inset hover:bg-brand/10")}
              >
                <TableCell className="whitespace-nowrap tabular-nums">{formatDateShort(l.date)}</TableCell>
                <TableCell className="max-w-[360px]">
                  <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]" title={l.narration}>
                    {l.narration || "No narration"}
                  </p>
                  {l.reference || l.kind || l.row ? (
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {[l.kind ? lineKindLabel(l.kind) : null, l.row ? `Row ${l.row} of the file` : null, l.reference ? `Ref ${l.reference}` : null].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">{l.withdrawal ? <Money value={l.withdrawal} exact className="text-danger" /> : null}</TableCell>
                <TableCell className="text-right">{l.deposit ? <Money value={l.deposit} exact className="text-success" /> : null}</TableCell>
                <TableCell className="text-right">{l.balance === null ? <span className="text-muted-foreground">-</span> : <Money value={l.balance} exact />}</TableCell>
                <TableCell className="space-y-1.5">
                  <LineState line={l} />
                  {l.state === "linked" && canUnmatch ? (
                    <Button type="button" size="sm" variant="outline" className="max-md:h-10" onClick={() => setUnmatching(l)}>
                      <Unlink /> Unmatch
                    </Button>
                  ) : (l.state === "deleted" || l.state === "review") && canAdd ? (
                    <Button type="button" size="sm" variant="outline" className="max-md:h-10" onClick={() => void review(l)} disabled={checking !== null}>
                      {checking === l.id ? <Spinner /> : <RotateCcw />} Review and add again
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={unmatching !== null}
        onOpenChange={(o) => (o ? null : setUnmatching(null))}
        title="Unmatch this line from its record?"
        description={
          <>
            {unmatching?.label ? `${unmatching.label} stays in the books exactly as it is. ` : "The record stays in the books exactly as it is. "}
            Only the tie between the record and this statement line is removed. After unmatching you can edit or delete the record from its own page. This line then
            needs review again: adding it again finds the record as already recorded while it exists.
          </>
        }
        confirmLabel="Unmatch"
        destructive={false}
        onConfirm={() => (unmatching ? unmatch(unmatching) : undefined)}
      />

      <ReviewAgain
        loaded={loaded}
        statement={statement}
        onChange={(d) => setLoaded((cur) => (cur ? { ...cur, decision: d } : cur))}
        onClose={() => setLoaded(null)}
      />
    </>
  );
}

function LineState({ line }: { line: StoredLine }) {
  if (line.state === "deleted") {
    return (
      <>
        <StatusBadge tone="warning">Linked record was deleted</StatusBadge>
        <p className="text-xs text-muted-foreground">The record this line became no longer exists. Review the line to add it again.</p>
      </>
    );
  }
  if (line.state === "review") {
    return (
      <>
        <StatusBadge tone="warning">Needs review</StatusBadge>
        {line.unmatchedAt ? (
          <p className="text-xs text-muted-foreground">
            Unmatched on {formatDate(line.unmatchedAt)}
            {line.unmatchedBy ? ` by ${line.unmatchedBy}` : ""}.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">Not tied to any record. Review it to tie it to its record or add it again.</p>
      </>
    );
  }
  if (line.state === "adding") {
    return (
      <>
        <StatusBadge tone="neutral">Being added</StatusBadge>
        <p className="text-xs text-muted-foreground">Being added in another window. Reload in a few minutes.</p>
      </>
    );
  }
  return (
    <>
      <ActionBadge action={line.action} />
      {line.href ? (
        <Link href={line.href} className="block text-xs text-brand-ink underline-offset-2 hover:underline [overflow-wrap:anywhere]">
          {line.label}
        </Link>
      ) : line.label ? (
        <p className="text-xs text-muted-foreground">{line.label}</p>
      ) : null}
    </>
  );
}

/** One stored line reviewed again against the books, as an upload would, and added from here. */
function ReviewAgain({ loaded, statement, onChange, onClose }: { loaded: Loaded | null; statement: StatementHeader; onChange: (d: LineDecision) => void; onClose: () => void }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const problem = loaded ? decisionProblem(loaded.review.line, loaded.decision, { accountId: loaded.review.accountId, pickers: loaded.review.pickers }) : null;

  async function add() {
    if (!loaded) return;
    const { review, decision } = loaded;
    setAdding(true);
    try {
      const { id: statementId, ...header } = statement;
      const res = await addStatementBatch({
        accountId: review.accountId,
        statementId: review.statementId ?? statementId,
        statement: header,
        lines: [{ ...toWire(review.line), occurrence: review.line.occurrence, decision: wireDecision(decision) }],
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const r = res.data.results[0];
      if (r && (r.status === "added" || r.status === "matched" || r.status === "ignored")) {
        toast.success(r.label ? `${r.message}: ${r.label}` : r.message);
        onClose();
      } else {
        toast.error(r?.message ?? "The line was not added. Try again.");
      }
      router.refresh();
    } catch {
      toast.error("The connection dropped while adding the line. Adding again is safe: a line already saved is not added twice.");
    } finally {
      setAdding(false);
    }
  }

  if (!loaded) return null;
  return (
    <LineEditor
      line={loaded.review.line}
      decision={loaded.decision}
      accountId={loaded.review.accountId}
      pickers={loaded.review.pickers}
      onChange={onChange}
      onClose={() => (adding ? null : onClose())}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {problem ? <p className="mr-auto text-xs text-warning">{problem}</p> : null}
          <Button type="button" variant="outline" onClick={onClose} disabled={adding}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void add()} disabled={adding || problem !== null}>
            {adding ? <Spinner /> : null}
            Add this line
          </Button>
        </div>
      }
    />
  );
}
