import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { INVOICE_LIST_STATUSES, type InvoiceListStatus } from "../schemas";
import { labelOf } from "@/lib/constants";

const TONES: Record<InvoiceListStatus, Tone> = {
  paid: "success",
  partial: "info",
  unpaid: "warning",
  overdue: "danger",
  cancelled: "neutral",
};

/** Payment status of an invoice (from invoiceBalances), or cancelled. */
export function InvoiceStatusBadge({ status, className }: { status: InvoiceListStatus; className?: string }) {
  return (
    <StatusBadge tone={TONES[status]} className={className}>
      {labelOf(INVOICE_LIST_STATUSES, status)}
    </StatusBadge>
  );
}
