import { EXPENSE_CATEGORIES, RECURRING_STATUSES, labelOf, type ExpenseCategory, type RecurringStatus } from "@/lib/constants";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";

const STATUS_TONE: Record<RecurringStatus, Tone> = { active: "success", paused: "warning", ended: "neutral" };

export function RecurringStatusBadge({ status }: { status: RecurringStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{labelOf(RECURRING_STATUSES, status)}</StatusBadge>;
}

export function CategoryBadge({ category }: { category: ExpenseCategory }) {
  return (
    <StatusBadge tone="neutral" dot={false}>
      {labelOf(EXPENSE_CATEGORIES, category)}
    </StatusBadge>
  );
}
