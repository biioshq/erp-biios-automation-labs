"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { DASHBOARD_PERIODS, DEFAULT_PERIOD, type DashboardPeriod } from "../periods";

/** Segmented control that writes ?period= and lets the server re-render the dashboard. */
export function PeriodSwitcher({ value }: { value: DashboardPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (!next || next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_PERIOD) params.delete("period");
    else params.set("period", next);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      onValueChange={change}
      aria-label="Reporting period"
      className={cn("transition-opacity", pending && "opacity-60")}
    >
      {DASHBOARD_PERIODS.map((p) => (
        <ToggleGroupItem key={p.value} value={p.value} className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
          {p.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
