"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Picks the item whose price history is charted; the choice lives in ?item= so it can be shared. */
export function ItemPicker({ items, value }: { items: { value: string; label: string; description: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("item", next);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger className={cn("w-full min-w-0 sm:w-72", pending && "opacity-70")} aria-label="Item">
        <SelectValue placeholder="Pick an item" />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            <span className="truncate">{i.label}</span>
            <span className="ml-1 text-xs text-muted-foreground">{i.description}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
