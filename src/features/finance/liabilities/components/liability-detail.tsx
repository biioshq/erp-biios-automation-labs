"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Banknote, CalendarDays, CalendarClock, FolderTree, Hash, Landmark, Pencil, Percent, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS } from "@/features/files/types";
import { LIABILITY_KINDS, LIABILITY_SOURCES, PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankAccountOption } from "@/server/lookups";
import { addLiabilityDocumentsAction, deleteRepaymentAction, removeLiabilityDocumentAction } from "../actions";
import { emiSchedule, type Schedule } from "../schedule";
import type { LiabilityDetail, RepaymentRow } from "../types";
import { LiabilityStatusBadge } from "./liability-badges";
import { RepaymentDialog } from "./repayment-dialog";
import { BankLineLink } from "@/features/finance/bank-statements/components/bank-line-link";

function Row({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "negative" | "positive" }) {
  return (
    <div className="min-w-0 rounded-lg border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Money value={value} exact tone={tone} className="mt-0.5 block text-sm font-semibold" />
    </div>
  );
}

export function LiabilityDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </FormSheetBody>
  );
}

/** A liability with its balance, terms, planned schedule, repayments and documents. */
export function LiabilityDetailView({
  liability,
  accounts,
  onEdit,
  onDelete,
  onChanged,
}: {
  liability: LiabilityDetail;
  accounts: BankAccountOption[];
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  /** Called after a repayment or document change, to load the record again. */
  onChanged: () => void;
}) {
  const [repaying, setRepaying] = useState(false);
  const isLoan = liability.kind === "loan";
  const schedule = useMemo(
    () =>
      emiSchedule(
        { originalAmount: liability.originalAmount, interestRate: liability.interestRate, tenureMonths: liability.tenureMonths, installment: liability.installment, date: liability.date },
        liability.principalPaid,
      ),
    [liability],
  );
  const suggestion = schedule?.next ? { principal: schedule.next.principal, interest: schedule.next.interest } : null;

  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{liability.code}</span>
            <StatusBadge tone="neutral" dot={false}>
              {labelOf(LIABILITY_KINDS, liability.kind)}
            </StatusBadge>
            <LiabilityStatusBadge status={liability.status} />
          </div>
          <Money value={liability.outstanding} exact className="block text-3xl font-semibold tracking-tight" />
          <p className="text-sm text-muted-foreground">
            Outstanding of <Money value={liability.originalAmount} exact /> {isLoan ? "borrowed from" : "owed to"} {liability.lender}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure label="Original amount" value={liability.originalAmount} />
          <Figure label="Principal repaid" value={liability.principalPaid} />
          <Figure label="Outstanding" value={liability.outstanding} tone={liability.status === "overdue" ? "negative" : undefined} />
          <Figure label="Interest paid" value={liability.interestPaid} />
        </div>

        <div className="divide-y rounded-xl border px-4">
          <Row icon={User} label={isLoan ? "Lender" : "Owed to"}>
            <p className="font-medium">{liability.lender}</p>
          </Row>
          <Row icon={FolderTree} label="Group">
            {liability.groupPath || liability.groupLabel}
          </Row>
          <Row icon={CalendarDays} label={isLoan ? "Taken on" : "Arose on"}>
            {formatDate(liability.date)}
          </Row>
          <Row icon={CalendarClock} label="Due date">
            {liability.dueDate ? formatDate(liability.dueDate) : <span className="text-muted-foreground">No due date</span>}
          </Row>
          <Row icon={Percent} label="Interest rate">
            {liability.interestRate !== null ? `${formatNumber(liability.interestRate)}% a year` : <span className="text-muted-foreground">Not recorded</span>}
          </Row>
          {isLoan ? (
            <Row icon={Banknote} label="Terms">
              {liability.tenureMonths || liability.installment ? (
                <>
                  {liability.tenureMonths ? `${liability.tenureMonths} months` : "Tenure not recorded"}
                  {" · "}
                  {liability.installment ? <Money value={liability.installment} exact /> : "instalment not recorded"}
                  {liability.installment ? " a month" : ""}
                </>
              ) : (
                <span className="text-muted-foreground">Tenure and instalment not recorded</span>
              )}
            </Row>
          ) : null}
          <Row icon={Landmark} label="Source">
            {liability.source.mode === "account"
              ? `Received into ${liability.source.accountName ?? `the default account for ${labelOf(PAYMENT_METHODS, liability.source.paymentMethod ?? "bank_transfer")}`}`
              : liability.source.mode === "accrued"
                ? `An expense not paid yet, booked to ${liability.source.categoryLabel ?? "a category no longer listed"}`
                : labelOf(LIABILITY_SOURCES, liability.source.mode)}
            {liability.fromBankStatement ? <span className="text-muted-foreground"> · from a bank statement</span> : null}
            {liability.bankTransactionId ? (
              <div>
                <BankLineLink id={liability.bankTransactionId} label="Unmatch it in Bank statements to change its amount or delete it" />
              </div>
            ) : null}
          </Row>
          <Row icon={Hash} label="Reference">
            {liability.reference ? <span className="font-mono text-[13px]">{liability.reference}</span> : <span className="text-muted-foreground">None recorded</span>}
          </Row>
        </div>

        {isLoan ? <ScheduleSection schedule={schedule} /> : null}

        <PaymentHistory liability={liability} onChanged={onChanged} />

        <Documents liability={liability} onChanged={onChanged} />

        {liability.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{liability.notes}</p>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Recorded {formatDateTime(liability.createdAt)}
          {liability.createdBy ? ` by ${liability.createdBy}` : ""}
          {liability.updatedAt !== liability.createdAt ? ` · updated ${formatDateTime(liability.updatedAt)}` : ""}
        </p>
      </FormSheetBody>
      <FormSheetFooter>
        {liability.paymentCount === 0 && !liability.fromBankStatement ? (
          <ConfirmDialog
            title="Delete this liability?"
            description={`${liability.code} ${liability.name} and its documents will be removed. It has no repayments.`}
            onConfirm={onDelete}
            trigger={
              <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                <Trash2 /> Delete
              </Button>
            }
          />
        ) : null}
        <Button variant="outline" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        {liability.outstanding > 0 ? (
          <Button onClick={() => setRepaying(true)}>
            <Banknote /> Record repayment
          </Button>
        ) : null}
      </FormSheetFooter>
      <RepaymentDialog
        key={`${liability.id}:${liability.paymentCount}`}
        liability={liability}
        accounts={accounts}
        suggestion={suggestion}
        open={repaying}
        onOpenChange={setRepaying}
        onDone={onChanged}
      />
    </>
  );
}

const SCHEDULE_TONES = { covered: "success", due: "danger", upcoming: "neutral" } as const;
const SCHEDULE_LABELS = { covered: "Covered", due: "Not covered", upcoming: "Upcoming" } as const;

function ScheduleSection({ schedule }: { schedule: Schedule | null }) {
  if (!schedule) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Repayment schedule</h3>
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          No schedule: the interest rate, tenure and monthly instalment are not all recorded. Edit the loan to add them and the planned EMIs show here.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Planned repayment schedule</h3>
        <p className="text-xs text-muted-foreground">
          Planned interest still to pay: <Money value={schedule.interestRemaining} exact className="font-medium text-foreground" />
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Worked out from the loan terms (reducing balance, monthly). An instalment counts as covered once the principal repaid reaches it. Actual repayments are listed below.
      </p>
      {schedule.warning ? <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{schedule.warning}</p> : null}
      {schedule.rows.length ? (
        <div className="max-h-80 overflow-auto rounded-xl border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Instalment</th>
                <th className="px-3 py-2 text-right font-medium">Interest</th>
                <th className="px-3 py-2 text-right font-medium">Principal</th>
                <th className="px-3 py-2 text-right font-medium">Balance after</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {schedule.rows.map((r) => (
                <tr key={r.n} className={cn(r.status === "covered" && "text-muted-foreground")}>
                  <td className="px-3 py-1.5 tabular">{r.n}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(r.dueDate)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Money value={r.installment} exact />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Money value={r.interest} exact />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Money value={r.principal} exact />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Money value={r.balance} exact />
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge tone={SCHEDULE_TONES[r.status]} className="h-5 px-2 text-[11px]">
                      {SCHEDULE_LABELS[r.status]}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function PaymentHistory({ liability, onChanged }: { liability: LiabilityDetail; onChanged: () => void }) {
  async function remove(p: RepaymentRow) {
    const result = await deleteRepaymentAction({ liabilityId: liability.id, paymentId: p.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.data.expenseNumber ? `Repayment deleted with interest expense ${result.data.expenseNumber}` : "Repayment deleted");
    emitDataChanged();
    onChanged();
    return true;
  }
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Payment history</h3>
      {liability.payments.length ? (
        <ul className="divide-y rounded-xl border">
          {liability.payments.map((p) => (
            <li key={p.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium">{formatDate(p.date)}</p>
                  <Money value={p.total} exact className="text-sm font-semibold" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Principal <Money value={p.principal} exact /> · Interest <Money value={p.interest} exact />
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {labelOf(PAYMENT_METHODS, p.paymentMethod)}
                  {p.account ? ` · ${p.account}` : ""}
                  {p.reference ? <span className="font-mono"> · {p.reference}</span> : null}
                  {p.fromBankStatement ? " · from a bank statement" : ""}
                </p>
                <BankLineLink id={p.bankTransactionId} label="Unmatch it in Bank statements to delete it" />
                {p.expense ? (
                  <Link href={`/finance/expenses?view=${p.expense.id}`} className="text-xs font-medium text-brand-ink hover:underline">
                    Interest expense {p.expense.number}
                  </Link>
                ) : null}
                {p.note ? <p className="text-xs whitespace-pre-wrap text-muted-foreground">{p.note}</p> : null}
              </div>
              {/* A repayment matched to a bank statement line stays: the statement still shows the money going out. */}
              {p.fromBankStatement ? null : (
                <ConfirmDialog
                  title="Delete this repayment?"
                  description={
                    p.expense
                      ? `The ${formatDate(p.date)} repayment and its interest expense ${p.expense.number} will be removed. What is owed goes back up by the principal.`
                      : `The ${formatDate(p.date)} repayment will be removed. What is owed goes back up by the principal.`
                  }
                  onConfirm={() => remove(p)}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="Delete repayment" className="text-muted-foreground hover:text-danger">
                      <Trash2 />
                    </Button>
                  }
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">No repayments recorded yet.</p>
      )}
    </section>
  );
}

function Documents({ liability, onChanged }: { liability: LiabilityDetail; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  function attach(fileId: string) {
    startTransition(async () => {
      const result = await addLiabilityDocumentsAction({ liabilityId: liability.id, fileIds: [fileId] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      emitDataChanged();
      onChanged();
    });
  }
  async function remove(fileId: string) {
    const result = await removeLiabilityDocumentAction({ liabilityId: liability.id, fileId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Document removed");
    emitDataChanged();
    onChanged();
  }
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Documents</h3>
      {liability.documents.length ? (
        <div className="space-y-2">
          {liability.documents.map((f) => (
            <DocumentTile key={f.id} file={f} onRemove={() => remove(f.id)} />
          ))}
        </div>
      ) : null}
      <FileDropzone
        meta={{ kind: "document" }}
        accept={ACCEPT_DOCUMENTS}
        compact
        disabled={pending}
        title={liability.documents.length ? "Add more documents" : "Drop the agreement, sanction letter or statements"}
        hint="PDF, images, Word, Excel"
        onUploaded={(file) => attach(file.id)}
      />
    </section>
  );
}

/** A saved document; removing it asks first, since the file is deleted. */
function DocumentTile({ file, onRemove }: { file: LiabilityDetail["documents"][number]; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <FileTile file={file} onRemove={() => setConfirming(true)} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove this document?"
        description={`${file.name} will be deleted.`}
        confirmLabel="Remove"
        onConfirm={onRemove}
      />
    </>
  );
}
