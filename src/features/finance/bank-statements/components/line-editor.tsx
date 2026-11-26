"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormSheet, FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { INCOME_CATEGORIES, PROJECT_STAGES, type BankLineAction, type IncomeCategory, type ProjectStage } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LineDecision, ReviewLine, StatementMethod, StatementPickers } from "../types";
import { STATEMENT_METHOD_OPTIONS } from "../schemas";
import { actionsFor, amountOf, decisionProblem, isWithdrawal, withAction } from "../review-state";
import { CheckBadge } from "./line-badges";
import { lineKindLabel, lineKindOf } from "../kinds";

const NONE = "__none";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Choice({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = "Pick one",
  allowNone,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string; description?: string }[];
  onChange: (v: string | undefined) => void;
  placeholder?: string;
  allowNone?: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value ?? (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowNone ? <SelectItem value={NONE}>{allowNone}</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
              {o.description ? <span className="text-muted-foreground"> · {o.description}</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A rupee amount typed as text, so "12." stays while typing; shows the value when it changes from outside. */
function AmountInput({ id, value, onChange }: { id: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const shown = text !== "" && Number(text) === value ? text : value === undefined ? text : String(value);
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={shown}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "");
        setText(t);
        const n = Number(t);
        onChange(t === "" || !Number.isFinite(n) ? undefined : round2(n));
      }}
    />
  );
}

/** Everything about one statement line and what it becomes. Changes apply as they are made. */
export function LineEditor({
  line,
  decision,
  accountId,
  pickers,
  onChange,
  onClose,
  footer,
}: {
  line: ReviewLine | null;
  decision: LineDecision | null;
  accountId: string;
  pickers: StatementPickers;
  onChange: (d: LineDecision) => void;
  onClose: () => void;
  /** Replaces the Done button (the statement page adds the line from here). */
  footer?: React.ReactNode;
}) {
  return (
    <FormSheet
      open={Boolean(line && decision)}
      onOpenChange={(o) => (o ? null : onClose())}
      title={line ? `${isWithdrawal(line) ? "Withdrawal" : "Deposit"} on ${formatDate(line.date)}` : "Statement line"}
      description={line ? `Row ${line.line} of the statement` : undefined}
    >
      {line && decision ? (
        <>
          <FormSheetBody className="space-y-5">
            <LineFacts line={line} decision={decision} />
            {line.imported ? (
              <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                Imported from an earlier statement on {formatDate(line.imported.on)}. Nothing is added for it again.
                {line.imported.href ? (
                  <>
                    {" "}
                    <Link href={line.imported.href} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                      Open {line.imported.label}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : (
              <DecisionFields line={line} decision={decision} accountId={accountId} pickers={pickers} onChange={onChange} />
            )}
          </FormSheetBody>
          <FormSheetFooter>
            {footer ?? (
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            )}
          </FormSheetFooter>
        </>
      ) : null}
    </FormSheet>
  );
}

function LineFacts({ line, decision }: { line: ReviewLine; decision: LineDecision }) {
  const kind = lineKindOf(isWithdrawal(line) ? "dr" : "cr", line.narrationKind ?? null, line.imported ? line.imported.action : decision.action);
  return (
    <div className="space-y-3 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Money value={amountOf(line)} exact className={cn("text-lg font-semibold", isWithdrawal(line) ? "text-danger" : "text-success")} />
        <CheckBadge check={line.check} />
      </div>
      <p className="[overflow-wrap:anywhere]">{line.narration || "No narration"}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Type</dt>
        <dd className="text-foreground">{lineKindLabel(kind)}</dd>
        {line.vendor ? (
          <>
            <dt>Vendor column</dt>
            <dd className="[overflow-wrap:anywhere] text-foreground">{line.vendor}</dd>
          </>
        ) : null}
        {line.category ? (
          <>
            <dt>Category column</dt>
            <dd className="[overflow-wrap:anywhere] text-foreground">{line.category}</dd>
          </>
        ) : null}
        {line.reference ? (
          <>
            <dt>Reference</dt>
            <dd className="[overflow-wrap:anywhere] text-foreground">{line.reference}</dd>
          </>
        ) : null}
        {line.valueDate ? (
          <>
            <dt>Value date</dt>
            <dd className="text-foreground">{formatDate(line.valueDate)}</dd>
          </>
        ) : null}
        <dt>Balance after</dt>
        <dd className="text-foreground">{line.balance === null ? "Not shown" : <Money value={line.balance} exact />}</dd>
      </dl>
      {[...line.issues, ...line.notes].length ? (
        <ul className="space-y-1 border-t pt-2 text-xs">
          {line.issues.map((i) => (
            <li key={i} className="text-warning">
              {i}.
            </li>
          ))}
          {line.notes.map((n) => (
            <li key={n} className="text-muted-foreground">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DecisionFields({
  line,
  decision: d,
  accountId,
  pickers,
  onChange,
}: {
  line: ReviewLine;
  decision: LineDecision;
  accountId: string;
  pickers: StatementPickers;
  onChange: (d: LineDecision) => void;
}) {
  const set = (patch: Partial<LineDecision>) => onChange({ ...d, ...patch });
  const problem = decisionProblem(line, d, { accountId, pickers });
  const amount = amountOf(line);
  const showMethod = d.action !== "match" && d.action !== "ignore" && d.action !== "transfer";
  const openProjects = pickers.projects.filter((p) => p.status !== "cancelled" || p.value === d.projectId);

  return (
    <div className="space-y-4">
      <Choice
        id="line-action"
        label="What this line is"
        value={d.action}
        options={actionsFor(line)}
        onChange={(v) => v && onChange(withAction(line, d, v as BankLineAction))}
      />

      {d.action === "match" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Record already in the books</p>
          {line.candidates.map((c) => (
            <label
              key={c.key}
              className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors", d.matchKey === c.key ? "border-brand/50 bg-brand/5" : "hover:bg-muted/40")}
            >
              <input type="radio" name="match" className="mt-1" checked={d.matchKey === c.key} onChange={() => set({ matchKey: c.key })} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block font-medium [overflow-wrap:anywhere]">{c.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDate(c.date)} · <Money value={c.amount} exact /> · {c.detail}
                </span>
                {c.otherAccount ? <span className="block text-xs text-warning">Counted in {c.otherAccount}, since it names no account.</span> : null}
              </span>
              <Link href={c.href} target="_blank" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${c.label}`}>
                <ExternalLink className="size-4" />
              </Link>
            </label>
          ))}
        </div>
      ) : null}

      {d.action === "expense" || d.action === "income" ? (
        <>
          <Field label={d.action === "expense" ? "Vendor" : "Received from"} htmlFor="line-party">
            <Input id="line-party" value={d.party ?? ""} maxLength={200} onChange={(e) => set({ party: e.target.value })} />
          </Field>
          {d.action === "expense" ? (
            <Choice id="line-category" label="Category" value={d.category} options={pickers.categories} onChange={(v) => set({ category: v })} />
          ) : (
            <Choice
              id="line-income-category"
              label="Category"
              value={d.incomeCategory}
              options={INCOME_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              onChange={(v) => set({ incomeCategory: v as IncomeCategory | undefined })}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="line-project"
              label="Project"
              value={d.projectId}
              options={openProjects}
              allowNone="No project"
              onChange={(v) => set({ projectId: v, stage: v ? d.stage : undefined })}
            />
            {d.action === "expense" && d.projectId ? (
              <Choice
                id="line-stage"
                label="Stage"
                value={d.stage}
                options={PROJECT_STAGES.map((s) => ({ value: s.value, label: s.label }))}
                onChange={(v) => set({ stage: v as ProjectStage | undefined })}
              />
            ) : null}
          </div>
          <Field label="Description" htmlFor="line-description">
            <Input id="line-description" value={d.description ?? ""} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </>
      ) : null}

      {d.action === "capital" || d.action === "drawing" ? (
        <>
          <Choice
            id="line-holder"
            label={d.action === "capital" ? "Who put the money in" : "Owner"}
            value={d.holderId}
            options={pickers.holders.filter((h) => d.action === "capital" || h.kind === "owner")}
            onChange={(v) => set({ holderId: v })}
          />
          {pickers.holders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No owners or investors are set up yet.{" "}
              <Link href="/finance/equity/owners" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                Add them on Capital / Equity
              </Link>
              , then upload again.
            </p>
          ) : null}
          <Field label="Purpose" htmlFor="line-purpose">
            <Input id="line-purpose" value={d.description ?? ""} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </>
      ) : null}

      {d.action === "loan_received" ? (
        <>
          <Field label="Lender" htmlFor="line-lender">
            <Input id="line-lender" value={d.party ?? ""} maxLength={200} onChange={(e) => set({ party: e.target.value })} />
          </Field>
          <Field label="Loan name" htmlFor="line-loan-name">
            <Input id="line-loan-name" value={d.loanName ?? ""} maxLength={160} onChange={(e) => set({ loanName: e.target.value })} />
          </Field>
          <Choice id="line-loan-group" label="Group" value={d.loanGroup} options={pickers.liabilityGroups} onChange={(v) => set({ loanGroup: v })} />
          <p className="text-xs text-muted-foreground">Interest rate, due date and documents can be added on the loan afterwards.</p>
        </>
      ) : null}

      {d.action === "loan_payment" ? (
        <>
          <Choice
            id="line-loan"
            label="Loan"
            value={d.loanId}
            options={pickers.loans.map((l) => ({ ...l, description: [l.description, l.outstanding !== null ? `${l.outstanding.toFixed(2)} outstanding` : null].filter(Boolean).join(" · ") }))}
            onChange={(v) => set({ loanId: v })}
          />
          {pickers.loans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No loans are recorded.{" "}
              <Link href="/finance/liabilities/loans?new=1" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                Add the loan
              </Link>
              , then upload again.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Principal" htmlFor="line-principal">
              <AmountInput id="line-principal" value={d.principal} onChange={(v) => set({ principal: v, interest: v === undefined ? d.interest : Math.max(0, round2(amount - v)) })} />
            </Field>
            <Field label="Interest" htmlFor="line-interest" hint="Booked as an interest expense">
              <AmountInput id="line-interest" value={d.interest} onChange={(v) => set({ interest: v, principal: v === undefined ? d.principal : Math.max(0, round2(amount - v)) })} />
            </Field>
          </div>
        </>
      ) : null}

      {d.action === "transfer" ? (
        <>
          <Choice
            id="line-other-account"
            label={isWithdrawal(line) ? "Moved to" : "Moved from"}
            value={d.otherAccountId}
            options={pickers.accounts.filter((a) => a.value !== accountId)}
            onChange={(v) => set({ otherAccountId: v })}
          />
          <p className="text-xs text-muted-foreground">
            A transfer moves money between your own accounts. It is neither income nor an expense. If the other account&apos;s statement already added it, this line is tied to the same transfer.
          </p>
        </>
      ) : null}

      {showMethod ? (
        <Choice
          id="line-method"
          label="Paid by"
          value={d.paymentMethod}
          options={STATEMENT_METHOD_OPTIONS.map((m) => ({ value: m.value, label: m.label }))}
          onChange={(v) => v && set({ paymentMethod: v as StatementMethod })}
        />
      ) : null}

      {d.action === "ignore" ? (
        <p className="text-sm text-muted-foreground">Nothing is added to the books. The line is remembered as ignored, so the next upload of this statement skips it.</p>
      ) : null}

      {problem ? (
        <p className="text-sm text-danger" role="alert">
          {problem}.
        </p>
      ) : null}
    </div>
  );
}
