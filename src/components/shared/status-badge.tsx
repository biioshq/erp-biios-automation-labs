import { AlertTriangle, CircleCheck, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MOVEMENT_TYPES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  labelOf,
  type MovementType,
  type ProjectStatus,
  type StockStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/constants";
import { STOCK_STATUS_META } from "@/lib/stock-status";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand" | "violet";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/25",
  info: "bg-info/10 text-info border-info/25",
  brand: "bg-brand/10 text-brand-ink border-brand/30",
  violet: "bg-chart-4/12 text-chart-4 border-chart-4/30",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  brand: "bg-brand",
  violet: "bg-chart-4",
};

/** The one badge shape used across the ERP. */
export function StatusBadge({
  tone = "neutral",
  dot = true,
  icon,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon ?? (dot ? <span className={cn("size-1.5 rounded-full", DOTS[tone])} aria-hidden /> : null)}
      {children}
    </span>
  );
}

/** Green In Stock / yellow Low Stock (warning icon) / red Out of Stock. Same colours everywhere. */
export function StockStatusBadge({ status, className }: { status: StockStatus; className?: string }) {
  const meta = STOCK_STATUS_META[status];
  const icon =
    status === "low_stock" ? (
      <AlertTriangle className="size-3" aria-hidden />
    ) : status === "out_of_stock" ? (
      <CircleX className="size-3" aria-hidden />
    ) : (
      <CircleCheck className="size-3" aria-hidden />
    );
  return (
    <StatusBadge tone={meta.tone} icon={icon} className={className}>
      {meta.label}
    </StatusBadge>
  );
}

const PROJECT_TONES: Record<ProjectStatus, Tone> = {
  planning: "info",
  active: "success",
  on_hold: "warning",
  completed: "violet",
  cancelled: "neutral",
};
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <StatusBadge tone={PROJECT_TONES[status]}>{labelOf(PROJECT_STATUSES, status)}</StatusBadge>;
}

export const TASK_STATUS_TONES: Record<TaskStatus | "overdue", Tone> = {
  pending: "neutral",
  in_progress: "info",
  review: "violet",
  completed: "success",
  cancelled: "neutral",
  overdue: "danger",
};
export function TaskStatusBadge({ status, overdue }: { status: TaskStatus; overdue?: boolean }) {
  if (overdue) return <StatusBadge tone="danger">Overdue</StatusBadge>;
  return <StatusBadge tone={TASK_STATUS_TONES[status]}>{labelOf(TASK_STATUSES, status)}</StatusBadge>;
}

export const PRIORITY_TONES: Record<TaskPriority, Tone> = { low: "neutral", medium: "info", high: "warning", urgent: "danger" };
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <StatusBadge tone={PRIORITY_TONES[priority]}>{labelOf(TASK_PRIORITIES, priority)}</StatusBadge>;
}

const MOVEMENT_TONES: Record<MovementType, Tone> = { purchase: "success", assign: "brand", return: "info", adjustment: "neutral" };
export function MovementTypeBadge({ type }: { type: MovementType }) {
  return <StatusBadge tone={MOVEMENT_TONES[type]}>{labelOf(MOVEMENT_TYPES, type)}</StatusBadge>;
}
