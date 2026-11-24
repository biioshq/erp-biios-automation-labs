"use client";

import { toast } from "sonner";
import { Landmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatDateTime } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { deleteExpensePayment } from "../payment-actions";
import { takesPayments } from "../sources";
import type { ExpenseDetail } from "../types";
import { PaymentStatusBadge } from "./expense-badges";
import { RecordPaymentButton } from "./record-payment-dialog";
import { BankLineLink } from "@/features/finance/bank-statements/components/bank-line-link";
import { useCan } from "@/components/current-user";

/**
 * The Payment section of the expense drawer: paid, still owed, due date and every payment
 * recorded, with Record payment and delete (each with its payments permission). Older expenses show
 * what their method implies.
 */
export function PaymentsPanel({ expense, accounts }: { expense: ExpenseDetail; accounts: BankAccountOption[] }) {
  const p = expense.payment;
  const canRecord = useCan("finance.payments:create");
  const canDelete = useCan("finance.payments:delete");
  const canPay = canRecord && takesPayments(expense.source) && !expense.countedAtPurchase && p.outstanding > 0 && p.status !== "stock";

  async function remove(paymentId: string) {
    const result = await deleteExpensePayment({ id: expense.id, paymentId });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Payment deleted");
    emitDataChanged();
    return true;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Payment <PaymentStatusBadge payment={p} />
        </h3>
        {canPay ? <RecordPaymentButton expense={{ id: expense.id, number: expense.number, vendor: expense.vendor, outstanding: p.outstanding }} accounts={accounts} size="sm" variant="outline" /> : null}
      </div>

      {p.status === "stock" ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Stock taken from inventory. It was paid for when it was bought, so it has no payment of its own.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-surface/40 p-4 sm:grid-cols-3">
          <div className="space-y-0.5">
            <p className="eyebrow text-[10px]">Paid</p>
            <Money value={p.paid} exact className="text-sm font-semibold" />
          </div>
          <div className="space-y-0.5">
            <p className="eyebrow text-[10px]">Still owed</p>
            <Money value={p.outstanding} exact className={p.outstanding > 0 ? "text-sm font-semibold text-danger" : "text-sm font-semibold"} />
          </div>
          <div className="space-y-0.5">
            <p className="eyebrow text-[10px]">{p.outstanding > 0 ? "Due" : "Paid from"}</p>
            <p className="text-sm font-medium">
              {p.outstanding > 0 ? (p.dueOn ? formatDate(p.dueOn) : "-") : p.explicit ? "See payments" : (expense.account?.name ?? "Default account")}
            </p>
          </div>
        </div>
      )}

      {p.explicit ? (
        expense.payments.length ? (
          <ul className="divide-y rounded-xl border" aria-label="Payments recorded">
            {expense.payments.map((pay) => (
              <li key={pay.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <Money value={pay.amount} exact className="font-semibold" />
                    <span className="text-muted-foreground">
                      {formatDate(pay.date)} · {labelOf(PAYMENT_METHODS, pay.paymentMethod)}
                      {pay.account ? ` · ${pay.account.name}` : ""}
                    </span>
                  </p>
                  {pay.reference || pay.note ? (
                    <p className="truncate text-xs text-muted-foreground">{[pay.reference, pay.note].filter(Boolean).join(" · ")}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Recorded{pay.createdAt ? ` ${formatDateTime(pay.createdAt)}` : ""}
                    {pay.createdBy ? ` by ${pay.createdBy.name}` : ""}
                    {pay.fromBankStatement ? (
                      <span className="inline-flex items-center gap-1">
                        {" "}
                        · <Landmark className="size-3" aria-hidden /> matched to a bank statement
                      </span>
                    ) : null}
                  </p>
                  <BankLineLink id={pay.bankTransactionId} label="Unmatch it in Bank statements" />
                </div>
                {canDelete && !pay.fromBankStatement && takesPayments(expense.source) ? (
                  <ConfirmDialog
                    title="Delete this payment?"
                    description={`${formatDate(pay.date)}, ${labelOf(PAYMENT_METHODS, pay.paymentMethod)}. The amount goes back to what is owed on ${expense.number}.`}
                    onConfirm={() => remove(pay.id)}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label="Delete payment" className="text-muted-foreground hover:text-danger">
                        <Trash2 />
                      </Button>
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">No payments recorded yet.</p>
        )
      ) : p.status !== "stock" ? (
        <p className="text-xs text-muted-foreground">
          {p.outstanding > 0
            ? "Recorded as on credit. Payments you record here are listed with who recorded them."
            : `Paid in full on ${formatDate(expense.date)} by ${labelOf(PAYMENT_METHODS, expense.paymentMethod).toLowerCase()}.`}
        </p>
      ) : null}
    </section>
  );
}
