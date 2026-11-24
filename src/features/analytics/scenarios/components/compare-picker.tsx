"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SCENARIO_TYPES, labelOf, type ScenarioType } from "@/lib/constants";
import { cn } from "@/lib/utils";

const MAX = 8;

/** Picks the scenarios to compare and which figures to use; the URL carries the choice (?ids=a,b&basis=saved). */
export function ComparePicker({
  choices,
  selected,
  basis,
}: {
  choices: { value: string; label: string; description: string; type: ScenarioType }[];
  selected: string[];
  basis: "today" | "saved";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const go = (ids: string[], b: "today" | "saved") => {
    const params = new URLSearchParams();
    if (ids.length) params.set("ids", ids.join(","));
    if (b === "saved") params.set("basis", "saved");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const toggle = (id: string) => go(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, MAX), basis);
  const picked = selected.map((id) => choices.find((c) => c.value === id)).filter((c): c is (typeof choices)[number] => Boolean(c));
  const exportHref = (format: "xlsx" | "pdf") => `/api/analytics/scenarios/compare?ids=${selected.join(",")}&basis=${basis}&format=${format}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal sm:w-80">
              <span className="truncate">{selected.length ? `${selected.length} scenarios picked` : "Pick scenarios to compare"}</span>
              {pending ? <Spinner /> : <ChevronsUpDown className="size-4 opacity-50" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search scenarios…" />
              <CommandList>
                <CommandEmpty>No scenario found.</CommandEmpty>
                <CommandGroup>
                  {choices.map((c) => (
                    <CommandItem key={c.value} value={`${c.label} ${c.description} ${c.value}`} onSelect={() => toggle(c.value)} disabled={!selected.includes(c.value) && selected.length >= MAX}>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{c.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {c.description} · {labelOf(SCENARIO_TYPES, c.type)}
                        </span>
                      </div>
                      <Check className={cn("size-4", selected.includes(c.value) ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <ToggleGroup type="single" variant="outline" size="sm" value={basis} onValueChange={(v) => v && go(selected, v as "today" | "saved")}>
          <ToggleGroupItem value="today">Today&apos;s data</ToggleGroupItem>
          <ToggleGroupItem value="saved">As saved</ToggleGroupItem>
        </ToggleGroup>
        {selected.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Download className="opacity-70" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={exportHref("xlsx")}>Excel (.xlsx)</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref("pdf")}>PDF</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {picked.length ? (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <span key={p.value} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs">
              <span className="truncate">
                {p.label} <span className="font-mono text-muted-foreground">{p.description}</span>
              </span>
              <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={`Remove ${p.label}`} onClick={() => toggle(p.value)}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
