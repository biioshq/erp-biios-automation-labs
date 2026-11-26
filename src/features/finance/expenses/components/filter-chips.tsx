"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type FilterChip = {
  label: string;
  /** The values the chip sets for the URL filter; empty means no filter ("All"). */
  values: string[];
  /** Shown after the label, such as a count. */
  extra?: React.ReactNode;
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

/**
 * A row of quick filters over one URL filter key that the table's faceted filter also writes
 * (comma separated, as the DataTable does), so the two always agree. Scrolls sideways on phones.
 */
export function FilterChips({ param, chips, label }: { param: string; chips: FilterChip[]; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = (searchParams.get(param) ?? "").split(",").filter(Boolean);

  const choose = (values: string[]) => {
    const next = new URLSearchParams(searchParams.toString());
    if (values.length) next.set(param, values.join(","));
    else next.delete(param);
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div role="group" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
      {chips.map((c) => {
        const active = sameSet(current, c.values);
        return (
          <button
            key={c.label}
            type="button"
            aria-pressed={active}
            onClick={() => choose(c.values)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors md:min-h-8",
              active ? "border-foreground bg-foreground font-medium text-background" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              pending && "opacity-70",
            )}
          >
            {c.label}
            {c.extra !== undefined ? <span className={cn("tabular text-xs", active ? "text-background/70" : "text-muted-foreground")}>{c.extra}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
