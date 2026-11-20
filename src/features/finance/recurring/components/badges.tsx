import { RECURRING_STATUSES, labelOf, type RecurringStatus } from "@/lib/constants";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";

const STATUS_TONE: Record<RecurringStatus, Tone> = { active: "success", paused: "warning", ended: "neutral" };

export function RecurringStatusBadge({ status }: { status: RecurringStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{labelOf(RECURRING_STATUSES, status)}</StatusBadge>;
}

/** The category's current name; queries resolve it (categoryLabel on rows), so renames show straight away. */
export function CategoryBadge({ label }: { label: string }) {
  return (
    <StatusBadge tone="neutral" dot={false}>
      {label}
    </StatusBadge>
  );
}
