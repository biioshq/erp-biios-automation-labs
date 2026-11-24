"use client";

import Link from "next/link";
import { AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import type { BankLineAction } from "@/lib/constants";
import { formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LineDecision, ReviewLine, StatementPickers } from "../types";
import { actionsFor, decisionSummary } from "../review-state";
import { CheckBadge } from "./line-badges";

export type TableRowState = { index: number; line: ReviewLine; decision: LineDecision; problem: string | null; selected: boolean };

/**
 * The statement's lines with what each becomes. The action can be changed in the row; everything
 * else (party, category, project, loan split) in the line editor.
 */
export function ReviewTable({
  rows,
  pickers,
  onToggle,
  onToggleAll,
  onAction,
  onEdit,
  disabled,
}: {
  rows: TableRowState[];
  pickers: StatementPickers;
  onToggle: (index: number, on: boolean) => void;
  onToggleAll: (indices: number[], on: boolean) => void;
  onAction: (index: number, action: BankLineAction) => void;
  onEdit: (index: number) => void;
  disabled?: boolean;
}) {
  const selectable = rows.filter((r) => !r.line.imported);
  const allOn = selectable.length > 0 && selectable.every((r) => r.selected);
  const someOn = selectable.some((r) => r.selected);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Tick every line shown"
                checked={allOn ? true : someOn ? "indeterminate" : false}
                disabled={disabled || selectable.length === 0}
                onCheckedChange={(v) => onToggleAll(selectable.map((r) => r.index), v === true)}
              />
            </TableHead>
            <TableHead className="w-24">Date</TableHead>
            <TableHead>Narration</TableHead>
            <TableHead className="w-32 text-right">Withdrawal</TableHead>
            <TableHead className="w-32 text-right">Deposit</TableHead>
            <TableHead className="w-36 text-right">Balance</TableHead>
            <TableHead className="w-72">Becomes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <Row key={r.index} row={r} pickers={pickers} onToggle={onToggle} onAction={onAction} onEdit={onEdit} disabled={disabled} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Row({
  row,
  pickers,
  onToggle,
  onAction,
  onEdit,
  disabled,
}: {
  row: TableRowState;
  pickers: StatementPickers;
  onToggle: (index: number, on: boolean) => void;
  onAction: (index: number, action: BankLineAction) => void;
  onEdit: (index: number) => void;
  disabled?: boolean;
}) {
  const { line, decision: d, problem, index } = row;
  const summary = line.imported ? null : decisionSummary(line, d, pickers);
  const warn = !line.imported && (line.attention || problem);
  return (
    <TableRow className={cn("align-top", line.imported && "text-muted-foreground", row.selected && "bg-brand/5")}>
      <TableCell className="pt-3">
        <Checkbox
          aria-label={`Add row ${line.line}`}
          checked={row.selected}
          disabled={disabled || Boolean(line.imported)}
          onCheckedChange={(v) => onToggle(index, v === true)}
        />
      </TableCell>
      <TableCell className="pt-3 whitespace-nowrap tabular-nums">{formatDateShort(line.date)}</TableCell>
      <TableCell className="max-w-[340px] min-w-[220px]">
        <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]" title={line.narration}>
          {line.narration || "No narration"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {line.reference ? <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Ref {line.reference}</span> : null}
          {line.check !== "ok" ? <CheckBadge check={line.check} /> : null}
          {warn ? (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3" aria-hidden />
              {problem ?? line.notes[0] ?? line.issues[0] ?? "Check this line"}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="pt-3 text-right">{line.withdrawal ? <Money value={line.withdrawal} exact className="text-danger" /> : null}</TableCell>
      <TableCell className="pt-3 text-right">{line.deposit ? <Money value={line.deposit} exact className="text-success" /> : null}</TableCell>
      <TableCell className="pt-3 text-right">{line.balance === null ? <span className="text-muted-foreground">-</span> : <Money value={line.balance} exact />}</TableCell>
      <TableCell>
        {line.imported ? (
          <div className="space-y-1 pt-1">
            <StatusBadge tone="neutral">Imported before</StatusBadge>
            {line.imported.href ? (
              <Link href={line.imported.href} className="block text-xs text-brand-ink underline-offset-2 hover:underline [overflow-wrap:anywhere]">
                {line.imported.label}
              </Link>
            ) : (
              <p className="text-xs">{line.imported.action === "ignore" ? "Ignored" : "Being added in another window. Upload again in a few minutes."}</p>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1 space-y-1">
              <Select value={d.action} onValueChange={(v) => onAction(index, v as BankLineAction)} disabled={disabled}>
                <SelectTrigger size="sm" className="w-full" aria-label={`What row ${line.line} becomes`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {actionsFor(line).map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {summary ? <p className="line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary}</p> : null}
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEdit(index)} aria-label={`Edit row ${line.line}`} disabled={disabled}>
              <Pencil />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
