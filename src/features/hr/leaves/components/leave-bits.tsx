import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";

/** "03 Nov 2026" for a "YYYY-MM-DD" day. */
export const dayLabel = (date: string) => formatDate(fromDateInput(date));

/** "1 day", "2.5 days", "Half a day". */
export function daysLabel(days: number): string {
  if (days === 0.5) return "Half a day";
  return `${formatNumber(days)} ${days === 1 ? "day" : "days"}`;
}

/** The leave type code with paid or unpaid: blue for paid, amber for unpaid, grey when not in the rules. */
export function LeaveTypeBadge({ code, name, paid }: { code: string; name?: string; paid: boolean | null }) {
  const tone = paid === null ? "neutral" : paid ? "info" : "warning";
  return (
    <StatusBadge tone={tone} dot={false}>
      <span className="font-mono text-[11px]" title={name}>
        {code}
      </span>
      <span className="opacity-80">{paid === null ? "not in rules" : paid ? "paid" : "unpaid"}</span>
    </StatusBadge>
  );
}
