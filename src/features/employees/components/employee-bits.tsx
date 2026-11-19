import { DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, labelOf, type Department, type EmployeeStatus, type EmploymentType } from "@/lib/constants";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";

/** One theme colour per department, used for avatars and badge dots. */
const DEPARTMENT_COLOR: Record<Department, string> = {
  engineering: "var(--chart-1)",
  installation: "var(--chart-2)",
  design: "var(--chart-3)",
  sales: "var(--chart-4)",
  operations: "var(--chart-5)",
  finance: "var(--brand)",
  management: "var(--muted-foreground)",
};

export const departmentColor = (d: Department) => DEPARTMENT_COLOR[d] ?? "var(--muted-foreground)";

const SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg sm:size-16 sm:text-xl" } as const;

/** Initials on a soft tint of the department colour. */
export function EmployeeAvatar({
  name,
  department,
  size = "md",
  className,
}: {
  name: string;
  department: Department;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const color = departmentColor(department);
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-full border font-semibold text-foreground select-none", SIZES[size], className)}
      style={{ background: `color-mix(in oklab, ${color} 22%, transparent)`, borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}
    >
      {initials(name)}
    </span>
  );
}

export function DepartmentBadge({ department, className }: { department: Department; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full border bg-muted px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      <span className="size-1.5 rounded-full" style={{ background: departmentColor(department) }} aria-hidden />
      <span className="truncate">{labelOf(DEPARTMENTS, department)}</span>
    </span>
  );
}

const STATUS_TONE: Record<EmployeeStatus, Tone> = { active: "success", on_leave: "warning", exited: "neutral" };

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{labelOf(EMPLOYEE_STATUSES, status)}</StatusBadge>;
}

export const employmentLabel = (type: EmploymentType) => labelOf(EMPLOYMENT_TYPES, type);

/** A small project chip: colour dot and name. */
export function ProjectChip({ name, color, suffix, className }: { name: string; color: string; suffix?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border bg-surface px-2 text-xs", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="truncate">{name}</span>
      {suffix ? <span className="tabular shrink-0 text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}

/** Allocation across projects: a bar that turns warning past 100%. */
export function AllocationBar({ value, className }: { value: number; className?: string }) {
  const over = value > 100;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${value}% allocated`}>
        <div className={cn("h-full rounded-full", over ? "bg-warning" : "bg-brand")} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className={cn("tabular w-9 shrink-0 text-right text-xs", over ? "font-medium text-warning" : "text-muted-foreground")}>{value}%</span>
    </div>
  );
}
