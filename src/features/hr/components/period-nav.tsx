"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { confirmLeave } from "./unsaved-changes";

/**
 * Previous / next and a picker for a day ("YYYY-MM-DD") or a month ("YYYY-MM"), kept in the URL
 * as `?date=` or `?month=` so the page reloads on the server. Other query values are kept.
 */
export function PeriodNav({
  kind,
  value,
  prev,
  next,
  label,
  todayValue,
  className,
}: {
  kind: "date" | "month";
  value: string;
  prev: string;
  next: string | null;
  /** "Wed, 25 Nov 2026" or "November 2026". */
  label: string;
  /** Today's day or month, for the "Today" / "This month" link. */
  todayValue: string;
  className?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const hrefFor = (v: string) => {
    const params = new URLSearchParams(search.toString());
    params.set(kind, v);
    return `?${params.toString()}`;
  };
  const noun = kind === "date" ? "day" : "month";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="icon" className="size-9" aria-label={`Previous ${noun}`}>
          <Link href={hrefFor(prev)} scroll={false} onClick={(e) => !confirmLeave() && e.preventDefault()}>
            <ChevronLeft />
          </Link>
        </Button>
        <Input
          type={kind}
          value={value}
          onChange={(e) => e.target.value && confirmLeave() && router.push(hrefFor(e.target.value), { scroll: false })}
          aria-label={kind === "date" ? "Pick a day" : "Pick a month"}
          className="tabular h-9 w-[160px]"
        />
        {next ? (
          <Button asChild variant="outline" size="icon" className="size-9" aria-label={`Next ${noun}`}>
            <Link href={hrefFor(next)} scroll={false} onClick={(e) => !confirmLeave() && e.preventDefault()}>
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" className="size-9" disabled aria-label={`Next ${noun}`}>
            <ChevronRight />
          </Button>
        )}
      </div>
      <span className="text-sm font-medium">{label}</span>
      {value !== todayValue ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={hrefFor(todayValue)} scroll={false} onClick={(e) => !confirmLeave() && e.preventDefault()}>
            {kind === "date" ? "Today" : "This month"}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
