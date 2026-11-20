"use client";

import Link from "next/link";
import { Boxes, CalendarDays, CreditCard, FolderKanban, Pencil, Receipt, Repeat, Tag, Trash2, User, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { FileTile } from "@/features/files/components/file-preview";
import { PAYMENT_METHODS, PROJECT_STAGES, labelOf } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { totalTax } from "@/lib/gst";
import type { ExpenseDetail } from "../types";
import { ExpenseSourceBadge } from "./expense-badges";

function Row({ icon: Icon, label, children }: { icon: typeof Tag; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="w-24 shrink-0 sm:w-32 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

function GstCell({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="eyebrow text-[10px]">{label}</p>
      <p className={mono ? "font-mono text-[13px]" : "text-sm font-medium"}>{value ?? "-"}</p>
    </div>
  );
}

export function ExpenseDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </FormSheetBody>
  );
}

/** Read-only view of an expense with its GST section and receipt. */
export function ExpenseDetailView({
  expense,
  onEdit,
  onDelete,
  canDelete = false,
}: {
  expense: ExpenseDetail;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  /** Only admins may delete; the server enforces it too. */
  canDelete?: boolean;
}) {
  const generated = expense.source === "inventory_assignment";
  const g = expense.gst;
  return (
    <>
      <FormSheetBody className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{expense.number}</span>
            <StatusBadge tone="neutral" dot={false}>
              {expense.categoryLabel}
            </StatusBadge>
            <ExpenseSourceBadge source={expense.source} />
          </div>
          <Money value={expense.amount} exact className="block text-3xl font-semibold tracking-tight" />
          <p className="text-sm text-muted-foreground">{expense.description ?? "No description"}</p>
          {expense.recurring ? (
            <Link
              href={`/finance/recurring?view=${expense.recurring.id}`}
              className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline"
            >
              <Repeat className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">From schedule {expense.recurring.name}</span>
            </Link>
          ) : null}
        </div>

        <div className="divide-y rounded-xl border px-4">
          <Row icon={User} label="Vendor">
            <p className="font-medium">{expense.vendor}</p>
            {expense.vendorAddress ? <p className="text-xs text-muted-foreground">{expense.vendorAddress}</p> : null}
          </Row>
          <Row icon={CalendarDays} label="Date">
            {formatDate(expense.date)}
          </Row>
          <Row icon={CreditCard} label="Payment">
            {labelOf(PAYMENT_METHODS, expense.paymentMethod)}
          </Row>
          <Row icon={FolderKanban} label="Project">
            {expense.project ? (
              <Link href={`/finance/projects/${expense.project.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                <span className="size-2 rounded-full" style={{ background: expense.project.color }} />
                {expense.project.name}
                {expense.stage ? <span className="font-normal text-muted-foreground">· {labelOf(PROJECT_STAGES, expense.stage)}</span> : null}
              </Link>
            ) : (
              <span className="text-muted-foreground">Company overhead</span>
            )}
          </Row>
          {expense.employee ? (
            <Row icon={UserRound} label="Employee">
              <Link href={`/finance/employees/${expense.employee.id}`} className="font-medium hover:underline">
                {expense.employee.name}
              </Link>
              {expense.category === "salaries" ? <p className="text-xs text-muted-foreground">Salary payment</p> : null}
            </Row>
          ) : null}
          {expense.item ? (
            <Row icon={Boxes} label="Inventory">
              <Link href={`/inventory/items/${expense.item.id}`} className="font-medium hover:underline">
                {expense.item.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {formatNumber(expense.quantity ?? 0)} × <Money value={expense.unitCost} /> ({expense.item.sku})
              </p>
            </Row>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">GST</h3>
            {g ? <span className="text-xs text-muted-foreground">Tax <Money value={totalTax(g)} /></span> : null}
          </div>
          {g ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-surface/40 p-4 sm:grid-cols-3">
              <GstCell label="GSTIN" value={g.gstin} mono />
              <GstCell label="Invoice no." value={g.invoiceNumber} mono />
              <GstCell label="Invoice date" value={g.invoiceDate ? formatDate(g.invoiceDate) : null} />
              <GstCell label="HSN / SAC" value={g.hsnSac} mono />
              <GstCell label="Taxable" value={<Money value={g.taxableAmount} />} />
              <GstCell label="CGST" value={<Money value={g.cgst} />} />
              <GstCell label="SGST" value={<Money value={g.sgst} />} />
              <GstCell label="IGST" value={<Money value={g.igst} />} />
              <GstCell label="CESS" value={<Money value={g.cess} />} />
              <div className="col-span-full">
                <Separator className="mb-3" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Grand total</span>
                  <Money value={g.grandTotal} exact className="text-base font-semibold" />
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              {generated ? "GST was recorded on the stock purchase invoice." : "No GST invoice recorded for this expense."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Receipt</h3>
          {expense.receipt ? (
            <FileTile file={expense.receipt} />
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <Receipt className="size-4" /> No receipt uploaded.
            </p>
          )}
        </section>

        {expense.notes ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Notes</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{expense.notes}</p>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Added {formatDateTime(expense.createdAt)}
          {expense.createdBy ? ` by ${expense.createdBy.name}` : ""}
          {expense.updatedAt !== expense.createdAt ? ` · updated ${formatDateTime(expense.updatedAt)}` : ""}
        </p>
      </FormSheetBody>
      <FormSheetFooter>
        {generated ? (
          <p className="mr-auto text-xs text-muted-foreground">Created by an inventory assignment. Return stock to change it.</p>
        ) : (
          <>
            {canDelete ? (
              <ConfirmDialog
                title="Delete this expense?"
                description={`${expense.number} from ${expense.vendor} and its receipt will be removed. Project budgets and reports update immediately.`}
                onConfirm={onDelete}
                trigger={
                  <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger">
                    <Trash2 /> Delete
                  </Button>
                }
              />
            ) : null}
            <Button onClick={onEdit}>
              <Pencil /> Edit
            </Button>
          </>
        )}
      </FormSheetFooter>
    </>
  );
}
