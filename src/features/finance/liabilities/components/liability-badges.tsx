import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { LIABILITY_STATUSES, PAYMENT_STATUSES, labelOf, type LiabilityStatus, type PaymentStatus } from "@/lib/constants";

const LIABILITY_TONES: Record<LiabilityStatus, Tone> = { paid: "success", pending: "warning", overdue: "danger" };
const PAYMENT_TONES: Record<PaymentStatus, Tone> = { paid: "success", partial: "info", unpaid: "warning", overdue: "danger" };

/** Paid, Pending or Overdue, from liabilityState. */
export function LiabilityStatusBadge({ status, className }: { status: LiabilityStatus; className?: string }) {
  return (
    <StatusBadge tone={LIABILITY_TONES[status]} className={className}>
      {labelOf(LIABILITY_STATUSES, status)}
    </StatusBadge>
  );
}

/** Unpaid, Partly paid or Overdue for a supplier bill, from paymentState. */
export function BillStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  return (
    <StatusBadge tone={PAYMENT_TONES[status]} className={className}>
      {labelOf(PAYMENT_STATUSES, status)}
    </StatusBadge>
  );
}
