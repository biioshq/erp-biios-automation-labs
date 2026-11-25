import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "../constants";

/** One colour per attendance status, used by the daily sheet, the register and the salary breakdown. */
export const ATTENDANCE_TONES: Record<AttendanceStatus | "unmarked", Tone> = {
  present: "success",
  half_day: "warning",
  absent: "danger",
  leave: "info",
  holiday: "violet",
  week_off: "neutral",
  unmarked: "neutral",
};

/** Cell colours for the monthly register (short codes on a tinted square). */
export const ATTENDANCE_CELL: Record<AttendanceStatus | "unmarked" | "off" | "not_employed", string> = {
  present: "bg-success/12 text-success",
  half_day: "bg-warning/15 text-warning",
  absent: "bg-danger/12 text-danger",
  leave: "bg-info/12 text-info",
  holiday: "bg-chart-4/12 text-chart-4",
  week_off: "bg-muted text-muted-foreground",
  off: "bg-muted/60 text-muted-foreground",
  unmarked: "text-muted-foreground/60",
  not_employed: "bg-transparent text-muted-foreground/40",
};

export function AttendanceBadge({ status, leaveType, className }: { status: AttendanceStatus | null; leaveType?: string | null; className?: string }) {
  if (!status) {
    return (
      <StatusBadge tone="neutral" dot={false} className={cn("border-dashed", className)}>
        Not marked
      </StatusBadge>
    );
  }
  const label = ATTENDANCE_STATUSES.find((s) => s.value === status)?.label ?? status;
  return (
    <StatusBadge tone={ATTENDANCE_TONES[status]} className={className}>
      {label}
      {leaveType && (status === "leave" || status === "half_day") ? <span className="opacity-80">· {leaveType}</span> : null}
    </StatusBadge>
  );
}
