"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { searchLinkableExpenses } from "../actions";
import type { LinkableExpense } from "../types";

export type PickedExpense = Pick<LinkableExpense, "id" | "number" | "vendor" | "amount" | "date"> & Partial<Pick<LinkableExpense, "gst">>;

/**
 * Searches company expenses that are not linked to another asset, by number, vendor, description
 * or invoice number, and picks one as the asset's purchase.
 */
export function ExpensePicker({
  value,
  assetId,
  invalid,
  onChange,
}: {
  value: PickedExpense | null;
  assetId?: string;
  invalid?: boolean;
  onChange: (expense: LinkableExpense) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkableExpense[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      searchLinkableExpenses({ q: query || undefined, assetId })
        .then((r) => {
          if (!cancelled && r.ok) setResults(r.data);
        })
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query, assetId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn("h-auto min-h-9 w-full justify-between py-1.5 font-normal", invalid && "border-danger")}
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2 text-left">
              <Receipt className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{value.vendor}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {value.number} · {formatDate(value.date)} · <Money value={value.amount} />
                </span>
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Search by expense number or vendor</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="EXP-2627-00042, vendor, invoice number…" />
          <CommandList>
            <CommandEmpty>{loading ? "Searching…" : "No unlinked company expense matches."}</CommandEmpty>
            <CommandGroup>
              {results.map((e) => (
                <CommandItem
                  key={e.id}
                  value={e.id}
                  onSelect={() => {
                    onChange(e);
                    setOpen(false);
                  }}
                  className="items-start"
                >
                  <Check className={cn("mt-0.5 size-4", value?.id === e.id ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{e.vendor}</span>
                      <Money value={e.amount} className="text-xs" />
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {e.number} · {formatDate(e.date)}
                      {e.invoiceNumber ? ` · Inv ${e.invoiceNumber}` : ""}
                      {e.gst > 0 ? " · GST recorded" : ""}
                    </p>
                    {e.description ? <p className="truncate text-xs text-muted-foreground">{e.description}</p> : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
