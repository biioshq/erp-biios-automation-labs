"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** A row of choices written to one URL parameter (horizon, view). The default choice leaves the URL clean. */
export function ParamToggle({
  param,
  options,
  value,
  label,
  defaultValue,
  className,
}: {
  param: string;
  /** Defaults to the first option. */
  defaultValue?: string;
  options: { value: string; label: string }[];
  value: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (!next) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === (defaultValue ?? options[0]?.value)) params.delete(param);
    else params.set(param, next);
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
      aria-label={label}
      className={cn("max-w-full overflow-x-auto", pending && "opacity-70", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-3 text-xs max-md:h-9 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
