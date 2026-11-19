"use client";

import { Check, PlusCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type FilterOption = { label: string; value: string; icon?: LucideIcon; count?: number };
export type FilterDef = { key: string; title: string; options: FilterOption[] };

/** Multi-select filter chip (status, category, project, vendor …). */
export function FacetedFilter({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const set = new Set(selected);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed font-normal max-md:h-10">
          <PlusCircle className="opacity-60" />
          {title}
          {set.size > 0 ? (
            <>
              <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                {set.size}
              </Badge>
              <div className="hidden gap-1 lg:flex">
                {set.size > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {set.size} selected
                  </Badge>
                ) : (
                  options
                    .filter((o) => set.has(o.value))
                    .map((o) => (
                      <Badge key={o.value} variant="secondary" className="rounded-sm px-1 font-normal">
                        {o.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 max-w-[calc(100vw-1rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = set.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => {
                      const next = new Set(set);
                      if (isSelected) next.delete(option.value);
                      else next.add(option.value);
                      onChange([...next]);
                    }}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-[4px] border",
                        isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input [&_svg]:invisible",
                      )}
                    >
                      <Check className="size-3 text-current" />
                    </div>
                    {option.icon ? <option.icon className="text-muted-foreground" /> : null}
                    <span className="truncate">{option.label}</span>
                    {option.count !== undefined ? (
                      <span className="tabular ml-auto font-mono text-xs text-muted-foreground">{option.count}</span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {set.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center text-center">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
