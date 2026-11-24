"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { INCOME_CATEGORIES, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatDate } from "@/lib/format";
import { applyReceiptToInvoice, fetchUnlinkedReceipts } from "../actions";
import { OVERPAYMENT_FIELD } from "../schemas";
import type { UnlinkedReceipt } from "../types";

/**
 * "Apply advance": links a receipt of the same client that is not on any invoice yet (usually an
 * advance) to this invoice. Nothing new is recorded; the receipt now settles the invoice.
 */
export function ApplyAdvanceButton({
  invoice,
  onApplied,
}: {
  invoice: { id: string; number: string; client: string; outstanding: number };
  onApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [receipts, setReceipts] = useState<UnlinkedReceipt[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ receipt: UnlinkedReceipt; message: string } | null>(null);

  function show() {
    setOpen(true);
    setReceipts(null);
    fetchUnlinkedReceipts(invoice.id)
      .then(setReceipts)
      .catch(() => {
        toast.error("Could not load the receipts. Try again.");
        setReceipts([]);
      });
  }

  function apply(receipt: UnlinkedReceipt, allowOverpayment = false) {
    setApplying(receipt.id);
    startTransition(async () => {
      const result = await applyReceiptToInvoice({ invoiceId: invoice.id, incomeId: receipt.id, allowOverpayment });
      setApplying(null);
      if (!result.ok) {
        if (result.fieldErrors?.[OVERPAYMENT_FIELD]) {
          setConfirm({ receipt, message: result.error });
          return;
        }
        toast.error(result.error);
        return;
      }
      toast.success(`${receipt.number} applied to ${invoice.number}`);
      setOpen(false);
      emitDataChanged();
      onApplied?.();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={show}>
        <HandCoins /> Apply advance
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply a receipt to {invoice.number}</DialogTitle>
            <DialogDescription>
              Receipts from {invoice.client} that are not linked to any invoice. Applying one settles {formatCurrency(invoice.outstanding, { exact: true })} outstanding
              (or part of it) without recording the money again.
            </DialogDescription>
          </DialogHeader>
          {receipts === null ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : receipts.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No unlinked receipts from {invoice.client}. Advances are recorded on the{" "}
              <Link href="/finance/income?new=1" className="underline underline-offset-2">
                income page
              </Link>{" "}
              with the category Advance.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {receipts.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Money value={r.amount} exact className="font-semibold" />
                      <StatusBadge tone={r.category === "advance" ? "info" : "neutral"} dot={false} className="h-5 px-2 text-[11px]">
                        {labelOf(INCOME_CATEGORIES, r.category)}
                      </StatusBadge>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{r.number}</span> · {formatDate(r.date)}
                      {r.reference ? ` · ${r.reference}` : ""}
                      {r.project ? ` · ${r.project.name}` : ""}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => apply(r)}>
                    {applying === r.id ? <Spinner /> : null}
                    Apply
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Apply more than is outstanding?"
        description={confirm?.message}
        confirmLabel="Apply anyway"
        destructive={false}
        onConfirm={() => {
          if (confirm) apply(confirm.receipt, true);
        }}
      />
    </>
  );
}
