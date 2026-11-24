"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, FileText, Link2Off, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { FileTile } from "@/features/files/components/file-preview";
import { INCOME_CATEGORIES, PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatDateTime } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { cancelInvoice, restoreInvoice, unlinkReceipt } from "../actions";
import type { InvoiceDetail } from "../types";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { RecordReceiptButton } from "./record-receipt-dialog";
import { ApplyAdvanceButton } from "./apply-advance-dialog";
import { useCan } from "@/components/current-user";

export function InvoiceDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </FormSheetBody>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-3 border-t pt-1.5 font-semibold" : "flex justify-between gap-3"}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd>
        <Money value={value} exact />
      </dd>
    </div>
  );
}

/** Read-only view of an invoice: lines, totals, the payments received against it and what is pending. */
export function InvoiceDetailView({
  invoice,
  accounts,
  canDelete,
  onEdit,
  onChanged,
  onDelete,
}: {
  invoice: InvoiceDetail;
  accounts: BankAccountOption[];
  canDelete: boolean;
  onEdit: () => void;
  /** Called after a payment, link or status change, to load the invoice again. */
  onChanged: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  // Receipts, links and the edit form need the invoices edit permission (the actions check it too).
  const canEdit = useCan("finance.invoices:edit");
  const cancelled = invoice.status === "cancelled";
  const hasReceipts = invoice.receipts.length > 0;

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    return new Promise<boolean>((resolve) =>
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          toast.error(result.error ?? "Something went wrong.");
          resolve(false);
          return;
        }
        toast.success(result.message ?? "Saved");
        emitDataChanged();
        onChanged();
        resolve(true);
      }),
    );
  }

  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{invoice.number}</span>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <Money value={invoice.total} exact className="block text-3xl font-semibold tracking-tight" />
          <p className="text-sm text-muted-foreground">
            Billed to {invoice.client}
            {invoice.clientGstin ? <span className="font-mono"> · {invoice.clientGstin}</span> : null}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Received</p>
            <Money value={invoice.received} exact tone={invoice.received > 0 ? "positive" : undefined} className="text-base font-semibold" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending</p>
            <Money value={invoice.outstanding} exact className={invoice.status === "overdue" ? "text-base font-semibold text-danger" : "text-base font-semibold"} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs text-muted-foreground">Last payment</p>
            <p className="text-sm font-medium">{invoice.lastReceivedOn ? formatDate(invoice.lastReceivedOn) : "None yet"}</p>
          </div>
          {invoice.credit > 0 ? (
            <p className="col-span-2 text-xs text-warning sm:col-span-3">
              Received <Money value={invoice.credit} exact /> more than the total. The books hold it as a customer advance, money the customer
              paid ahead.
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Invoice date">{formatDate(invoice.date)}</Fact>
          <Fact label="Due date">{invoice.dueDate ? formatDate(invoice.dueDate) : <span className="text-muted-foreground">Not set</span>}</Fact>
          <Fact label="Project">
            {invoice.project ? (
              <Link href={`/finance/projects/${invoice.project.id}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
                <span className="size-2 rounded-full" style={{ background: invoice.project.color }} />
                {invoice.project.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">Not linked</span>
            )}
          </Fact>
          <Fact label="Supply">{invoice.interState ? "Another state (IGST)" : "Within the state (CGST + SGST)"}</Fact>
        </dl>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Line items</h3>
          <div className="overflow-x-auto rounded-xl border">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-64 whitespace-normal">
                      <p>{l.description}</p>
                      {l.hsnSac ? <p className="font-mono text-[11px] text-muted-foreground">HSN/SAC {l.hsnSac}</p> : null}
                    </TableCell>
                    <TableCell className="tabular text-right">{l.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Money value={l.rate} exact />
                    </TableCell>
                    <TableCell className="tabular text-right">{l.gstRate}%</TableCell>
                    <TableCell className="text-right">
                      <Money value={l.amount} exact />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
            <TotalRow label="Taxable value" value={invoice.taxableAmount} />
            {invoice.interState ? (
              <TotalRow label="IGST" value={invoice.igst} />
            ) : (
              <>
                <TotalRow label="CGST" value={invoice.cgst} />
                <TotalRow label="SGST" value={invoice.sgst} />
              </>
            )}
            <TotalRow label="Invoice total" value={invoice.total} strong />
          </dl>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Payments received</h3>
            {cancelled || !canEdit ? null : (
              <div className="flex flex-wrap gap-2">
                <ApplyAdvanceButton invoice={invoice} onApplied={onChanged} />
                <RecordReceiptButton invoice={invoice} accounts={accounts} onRecorded={onChanged} />
              </div>
            )}
          </div>
          {hasReceipts ? (
            <div className="overflow-x-auto rounded-xl border">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell>
                        <Link href={`/finance/income?view=${r.id}`} className="font-mono text-xs font-medium hover:underline">
                          {r.number}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">
                          {labelOf(INCOME_CATEGORIES, r.category)}
                          {r.reference ? <span className="font-mono"> · {r.reference}</span> : null}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {labelOf(PAYMENT_METHODS, r.paymentMethod)}
                        {r.account ? <p className="text-[11px]">{r.account.name}</p> : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={r.amount} exact tone="positive" className="font-medium" />
                      </TableCell>
                      <TableCell>
                        {canEdit ? (
                          <ConfirmDialog
                            title={`Remove ${r.number} from this invoice?`}
                            description="The receipt stays recorded, but no longer settles this invoice. It then counts as income of its own category, and the invoice shows that amount as pending again."
                            confirmLabel="Remove link"
                            destructive={false}
                            onConfirm={() => run(() => unlinkReceipt({ incomeId: r.id }))}
                            trigger={
                              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.number} from this invoice`} disabled={pending}>
                                <Link2Off />
                              </Button>
                            }
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>Total received</TableCell>
                    <TableCell className="text-right">
                      <Money value={invoice.received} exact />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              {cancelled ? "This invoice is cancelled." : "Nothing received against this invoice yet."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Invoice file</h3>
          {invoice.file ? (
            <FileTile file={invoice.file} />
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <FileText className="size-4" /> No file attached.
            </p>
          )}
        </section>

        {invoice.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{invoice.notes}</p>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(invoice.createdAt)}
          {invoice.createdBy ? ` by ${invoice.createdBy.name}` : ""}
          {invoice.updatedAt !== invoice.createdAt ? ` · updated ${formatDateTime(invoice.updatedAt)}` : ""}
        </p>
      </FormSheetBody>
      <FormSheetFooter className="flex-wrap">
        {canDelete && !hasReceipts ? (
          <div className="mr-auto flex flex-wrap gap-1">
            <ConfirmDialog
              title={`Delete ${invoice.number}?`}
              description="The invoice and its file are removed for good. To keep a record of it, cancel it instead."
              onConfirm={onDelete}
              trigger={
                <Button variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger">
                  <Trash2 /> Delete
                </Button>
              }
            />
            {cancelled ? null : (
              <ConfirmDialog
                title={`Cancel ${invoice.number}?`}
                description="A cancelled invoice stays on the list, but no longer counts as revenue or as money the customer owes. You can restore it later."
                confirmLabel="Cancel invoice"
                onConfirm={() => run(() => cancelInvoice({ id: invoice.id }))}
                trigger={
                  <Button variant="ghost">
                    <Ban /> Cancel invoice
                  </Button>
                }
              />
            )}
          </div>
        ) : null}
        {cancelled ? (
          canDelete ? (
            <Button variant="outline" disabled={pending} onClick={() => void run(() => restoreInvoice({ id: invoice.id }))}>
              <RotateCcw /> Restore
            </Button>
          ) : null
        ) : canEdit ? (
          <Button onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
      </FormSheetFooter>
    </>
  );
}
