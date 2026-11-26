"use client";

import Link from "next/link";
import { CalendarDays, CreditCard, Download, FilePlus2, FileText, FolderKanban, Hash, Landmark, Pencil, Receipt, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { FileTile } from "@/features/files/components/file-preview";
import { INCOME_CATEGORIES, PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { BankLineLink } from "@/features/finance/bank-statements/components/bank-line-link";
import type { IncomeDetail } from "../types";
import { useCan } from "@/components/current-user";
import { createInvoiceHref, needsInvoice } from "../invoice-flag";
import { AuditHistory } from "@/features/finance/audit/components/audit-history";

function Row({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

export function IncomeDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </FormSheetBody>
  );
}

/** Read-only view of an income record with its receipt. */
export function IncomeDetailView({
  income,
  onEdit,
  onDelete,
  canDelete = false,
}: {
  income: IncomeDetail;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  /** Needs the income delete permission; the server enforces it too. */
  canDelete?: boolean;
}) {
  const canEdit = useCan("finance.income:edit");
  const mayCreateInvoice = useCan("finance.invoices:create");
  const mayLinkInvoice = useCan("finance.invoices:edit");
  const canCreateInvoice = mayCreateInvoice && mayLinkInvoice;
  const noInvoice = needsInvoice(income);
  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{income.number}</span>
            <StatusBadge tone="success" dot={false}>
              {labelOf(INCOME_CATEGORIES, income.category)}
            </StatusBadge>
          </div>
          <Money value={income.amount} exact tone="positive" className="block text-3xl font-semibold tracking-tight" />
          <p className="text-sm text-muted-foreground">Received from {income.client}</p>
        </div>

        <div className="divide-y rounded-xl border px-4">
          <Row icon={User} label="Client">
            <p className="font-medium">{income.client}</p>
          </Row>
          <Row icon={CalendarDays} label="Date">
            {formatDate(income.date)}
          </Row>
          <Row icon={CreditCard} label="Payment">
            {labelOf(PAYMENT_METHODS, income.paymentMethod)}
          </Row>
          <Row icon={Landmark} label="Received into">
            {income.account ? (
              <span className="font-medium">{income.account.name}</span>
            ) : (
              <span className="text-muted-foreground">Default account for {labelOf(PAYMENT_METHODS, income.paymentMethod).toLowerCase()}</span>
            )}
            {income.fromBankStatement ? (
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>Matched to a bank statement line</span>
                <BankLineLink id={income.bankTransactionId} />
              </div>
            ) : null}
          </Row>
          <Row icon={FileText} label="Invoice">
            {income.invoice ? (
              <>
                <Link href={`/finance/invoices?view=${income.invoice.id}`} className="font-mono text-[13px] font-medium hover:underline">
                  {income.invoice.number}
                </Link>
                <p className="text-xs text-muted-foreground">This payment settles that invoice, so it is not counted as revenue again.</p>
              </>
            ) : noInvoice ? (
              <div className="space-y-1.5">
                <StatusBadge tone="warning" dot={false}>
                  No invoice
                </StatusBadge>
                <p className="text-xs text-muted-foreground">
                  This is a sale receipt with no invoice. Until one is linked it counts as revenue by itself.
                </p>
                {canCreateInvoice ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={createInvoiceHref(income.id)}>
                      <FilePlus2 /> Create invoice
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <span className="text-muted-foreground">Not linked to an invoice</span>
            )}
          </Row>
          <Row icon={Hash} label="Reference">
            {income.reference ? <span className="font-mono text-[13px]">{income.reference}</span> : <span className="text-muted-foreground">None recorded</span>}
          </Row>
          <Row icon={FolderKanban} label="Project">
            {income.project ? (
              <Link href={`/finance/projects/${income.project.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                <span className="size-2 rounded-full" style={{ background: income.project.color }} />
                {income.project.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">Not linked to a project</span>
            )}
          </Row>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Receipt</h3>
          {income.receipt ? (
            <FileTile file={income.receipt} />
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <Receipt className="size-4" /> No receipt uploaded.
            </p>
          )}
        </section>

        {income.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{income.notes}</p>
          </section>
        ) : null}

        <AuditHistory key={income.id} type="income" id={income.id} number={income.number} />

        <p className="text-xs text-muted-foreground">
          Recorded {formatDateTime(income.createdAt)}
          {income.createdBy ? ` by ${income.createdBy.name}` : ""}
          {income.updatedAt !== income.createdAt ? ` · updated ${formatDateTime(income.updatedAt)}` : ""}
        </p>
      </FormSheetBody>
      <FormSheetFooter>
        {canDelete ? (
          <ConfirmDialog
            title="Delete this income record?"
            description={`${income.number} from ${income.client} and its receipt will be removed. Project and dashboard totals update immediately.${income.invoice ? ` ${income.invoice.number} will show this amount as pending again.` : ""}`}
            onConfirm={onDelete}
            trigger={
              <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                <Trash2 /> Delete
              </Button>
            }
          />
        ) : null}
        <Button variant="outline" asChild>
          <a href={`/api/documents/receipt/${income.id}`}>
            <Download /> Download receipt
          </a>
        </Button>
        {canEdit ? (
          <Button onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
      </FormSheetFooter>
    </>
  );
}
