"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { BadgeIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ComboboxField, DateField, NumberField, SelectField, TextField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { applyFieldErrors } from "@/lib/action-result";
import { INCOME_CATEGORIES } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { recordInvoiceReceipt } from "../actions";
import { OVERPAYMENT_FIELD, RECEIPT_METHODS, invoiceReceiptSchema, type InvoiceReceiptInput, type InvoiceReceiptValues } from "../schemas";

/**
 * "Record payment received": a small form that creates an income record linked to the invoice.
 * The amount starts at what is outstanding; more than that needs a confirmation.
 */
export function RecordReceiptButton({
  invoice,
  accounts,
  onRecorded,
}: {
  invoice: { id: string; number: string; client: string; outstanding: number };
  accounts: BankAccountOption[];
  onRecorded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [overpayment, setOverpayment] = useState<string | null>(null);
  const defaults = (): InvoiceReceiptInput => ({
    invoiceId: invoice.id,
    amount: invoice.outstanding > 0 ? invoice.outstanding : (undefined as unknown as number),
    date: toDateInput(new Date()),
    category: "project_payment",
    paymentMethod: "bank_transfer",
    accountId: undefined,
    reference: "",
    notes: "",
  });
  const form = useForm<InvoiceReceiptInput, unknown, InvoiceReceiptValues>({
    resolver: zodResolver(invoiceReceiptSchema),
    defaultValues: defaults(),
    ...formValidation,
  });
  const accountOptions = useMemo(() => accounts.map((a) => ({ value: a.value, label: a.label, description: a.description || undefined })), [accounts]);
  // Advances are recorded on the income page; a payment against an invoice settles it.
  const categories = INCOME_CATEGORIES.filter((c) => c.value !== "advance" && c.value !== "interest" && c.value !== "grant");

  function show() {
    form.reset(defaults());
    setOverpayment(null);
    setOpen(true);
  }

  function save(values: InvoiceReceiptValues) {
    startTransition(async () => {
      const result = await recordInvoiceReceipt(values);
      if (!result.ok) {
        if (result.fieldErrors?.[OVERPAYMENT_FIELD]) {
          setOverpayment(result.error);
          return;
        }
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.number} recorded against ${invoice.number}`);
      setOpen(false);
      emitDataChanged();
      onRecorded?.();
    });
  }

  return (
    <>
      <Button type="button" onClick={show}>
        <BadgeIndianRupee /> Record payment received
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={form.handleSubmit(save)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>Payment received for {invoice.number}</DialogTitle>
              <DialogDescription>
                From {invoice.client}. {formatCurrency(invoice.outstanding, { exact: true })} is outstanding. This creates an income record linked to the invoice.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField control={form.control} name="amount" label="Amount received" currency required />
              <DateField control={form.control} name="date" label="Date received" required />
              <SelectField control={form.control} name="paymentMethod" label="Payment mode" required options={RECEIPT_METHODS} />
              <SelectField control={form.control} name="category" label="Category" required options={categories} />
              <ComboboxField
                control={form.control}
                name="accountId"
                label="Received into"
                options={accountOptions}
                placeholder="Default account for the payment mode"
                searchPlaceholder="Search accounts…"
                emptyText="No accounts set up yet."
                clearable
                className="sm:col-span-2"
              />
              <TextField control={form.control} name="reference" label="Transaction reference" placeholder="UTR, transaction id or cheque number" mono className="sm:col-span-2" />
              <TextField control={form.control} name="notes" label="Note" className="sm:col-span-2" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Record payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={overpayment !== null}
        onOpenChange={(o) => !o && setOverpayment(null)}
        title="Record more than is outstanding?"
        description={overpayment ?? undefined}
        confirmLabel="Record anyway"
        destructive={false}
        onConfirm={() => {
          void form.handleSubmit((v) => save({ ...v, allowOverpayment: true }))();
        }}
      />
    </>
  );
}
