"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangeFilter } from "@/components/data-table";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string; description?: string };

type Props = {
  materials?: FilterOption[];
  categories?: FilterOption[];
  projects?: FilterOption[];
  /** Show the history window picker (?from&to). */
  window?: { from: string; to: string; isDefault: boolean };
  /** Pick one project, no "All projects" choice; the first is shown when none is picked. */
  oneProject?: boolean;
  className?: string;
};

const ALL = "all";

/** Material, category, project and history window filters, kept in the URL so views can be shared. */
export function ForecastFilters({ materials, categories, projects, window, oneProject, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The calendar reports the first click of a range on its own; wait for both ends.
  const [draft, setDraft] = useState<{ from: string | null; to: string | null } | null>(null);

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const keys = ["item", "category", "project", "from", "to"];
  const active = keys.some((k) => searchParams.get(k)) && !oneProject;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70", className)} aria-busy={pending}>
      {materials ? <MaterialPicker options={materials} value={searchParams.get("item")} onChange={(v) => update({ item: v })} /> : null}
      {categories ? (
        <OptionSelect label="Category" allLabel="All categories" options={categories} value={searchParams.get("category")} onChange={(v) => update({ category: v })} />
      ) : null}
      {projects ? (
        <OptionSelect label="Project" allLabel={oneProject ? null : "All projects"} options={projects} value={searchParams.get("project")} onChange={(v) => update({ project: v })} />
      ) : null}
      {window ? (
        <DateRangeFilter
          label="History window"
          from={draft ? draft.from : window.isDefault ? null : window.from}
          to={draft ? draft.to : window.isDefault ? null : window.to}
          className="text-sm max-sm:flex-1"
          onChange={(range) => {
            if (range.from && !range.to) {
              setDraft(range);
              return;
            }
            setDraft(null);
            update({ from: range.from, to: range.to });
          }}
        />
      ) : null}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 max-md:h-10"
          onClick={() => {
            setDraft(null);
            update(Object.fromEntries(keys.map((k) => [k, null])));
          }}
        >
          <RotateCcw /> Reset
        </Button>
      ) : null}
    </div>
  );
}

function OptionSelect({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  /** null: no "all" choice. */
  allLabel: string | null;
  options: FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const fallback = allLabel === null ? (options[0]?.value ?? ALL) : ALL;
  const current = value && options.some((o) => o.value === value) ? value : fallback;
  return (
    <Select value={current} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className={cn("w-full sm:w-48", current === ALL && "border-dashed")} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel !== null ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MaterialPicker({ options, value, onChange }: { options: FilterOption[]; value: string | null; onChange: (value: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Material"
          className={cn("h-8 w-full justify-between text-sm font-normal max-md:h-10 sm:w-56", !current && "border-dashed text-muted-foreground")}
        >
          <span className="truncate">{current?.label ?? "All materials"}</span>
          <span className="flex items-center gap-1">
            {current ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear material"
                className="rounded p-0.5 hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                <X className="size-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search name or SKU" />
          <CommandList>
            <CommandEmpty>No material found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.description ?? ""} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.description ? <span className="truncate text-xs text-muted-foreground">{o.description}</span> : null}
                  </div>
                  <Check className={cn("size-4", value === o.value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
