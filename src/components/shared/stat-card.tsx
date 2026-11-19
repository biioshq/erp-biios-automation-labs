import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "default" | "brand" | "success" | "warning" | "danger" | "info";

const ICON_TONES: Record<Tone, string> = {
  default: "bg-muted text-foreground",
  brand: "bg-brand/12 text-brand-ink",
  success: "bg-success/12 text-success",
  warning: "bg-warning/14 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
};

/**
 * A KPI tile. `delta` is a ratio (0.12 = +12%) compared with `deltaLabel`;
 * set `invertDelta` when a rise is bad (expenses).
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  delta,
  deltaLabel,
  invertDelta,
  footer,
  compact,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  delta?: number | null;
  deltaLabel?: string;
  invertDelta?: boolean;
  footer?: React.ReactNode;
  /** Smaller padding and value size at every width. Phones always use the compact size. */
  compact?: boolean;
  className?: string;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta! >= 0;
  const good = hasDelta && (invertDelta ? !up : up);
  return (
    <div
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-xl border bg-card shadow-card transition-colors hover:border-foreground/15",
        compact ? "p-3.5" : "p-3.5 sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <p className="min-w-0 text-[12.5px] leading-snug font-medium text-muted-foreground sm:text-[13px]">{label}</p>
        {Icon ? (
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg sm:size-8", compact && "sm:size-7", ICON_TONES[tone])}>
            <Icon className="size-3.5 sm:size-4" />
          </span>
        ) : null}
      </div>
      <div className={cn("tabular mt-1.5 text-lg leading-none font-semibold tracking-tight sm:mt-2 sm:text-xl", compact ? "" : "sm:text-[26px]")}>
        {value}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {hasDelta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular",
              good ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
            )}
          >
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta! * 100).toFixed(1)}%
          </span>
        ) : null}
        {deltaLabel && hasDelta ? <span>{deltaLabel}</span> : null}
        {hint ? <span>{hint}</span> : null}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

/**
 * KPI grid: two columns on phones, two on tablets, four from xl. Pass `compact={false}`
 * for tall cards (charts, long footers) that need one column on phones.
 */
export function StatGrid({
  className,
  children,
  compact = true,
}: {
  className?: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4", compact && "grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2", className)}>{children}</div>
  );
}
