"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useTableUrl } from "@/components/data-table";
import { cn } from "@/lib/utils";
import type { LeaveEmployeeOption } from "../types";

/** Leave year (previous / next, kept in ?year=) and the employee filter (?employee=). */
export function LeavesToolbar({
  yearStart,
  yearLabel,
  prevYear,
  nextYear,
  currentYear,
  employees,
  employeeId,
}: {
  /** "YYYY-MM", the first month of the leave year shown. */
  yearStart: string;
  /** "2026" or "2026-27". */
  yearLabel: string;
  prevYear: string;
  nextYear: string | null;
  currentYear: string;
  employees: LeaveEmployeeOption[];
  employeeId: string | null;
}) {
  const search = useSearchParams();
  const url = useTableUrl();
  const [open, setOpen] = useState(false);
  const hrefFor = (year: string) => {
    const params = new URLSearchParams(search.toString());
    if (year === currentYear) params.delete("year");
    else params.set("year", year);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };
  const selected = employees.find((e) => e.id === employeeId) ?? null;

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", url.isPending && "opacity-70 transition-opacity")}>
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="icon" className="size-10 sm:size-9" aria-label="Previous leave year">
          <Link href={hrefFor(prevYear)} scroll={false}>
            <ChevronLeft />
          </Link>
        </Button>
        <div className="min-w-0 px-2 text-center">
          <p className="tabular text-sm font-semibold">Leave year {yearLabel}</p>
        </div>
        {nextYear ? (
          <Button asChild variant="outline" size="icon" className="size-10 sm:size-9" aria-label="Next leave year">
            <Link href={hrefFor(nextYear)} scroll={false}>
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" className="size-10 sm:size-9" disabled aria-label="Next leave year">
            <ChevronRight />
          </Button>
        )}
        {yearStart !== currentYear ? (
          <Button asChild variant="ghost" size="sm" className="h-10 sm:h-9">
            <Link href={hrefFor(currentYear)} scroll={false}>
              This year
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label="Filter by employee"
              className={cn("h-10 w-full justify-between px-2.5 font-normal sm:h-9 sm:w-64", !employeeId && "text-muted-foreground")}
            >
              <span className="flex min-w-0 items-center gap-2 truncate">
                <UserRound className="size-4 opacity-60" />
                <span className="truncate">{selected ? selected.name : employeeId ? "Selected person" : "All employees"}</span>
              </span>
              <ChevronsUpDown className="size-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-64 p-0" align="end">
            <Command>
              <CommandInput placeholder="Search people…" />
              <CommandList>
                <CommandEmpty>Nobody found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="all employees"
                    onSelect={() => {
                      url.set({ employee: null });
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1">All employees</span>
                    <Check className={cn("size-4", !employeeId ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                  {employees.map((e) => (
                    <CommandItem
                      key={e.id}
                      value={`${e.name} ${e.code} ${e.designation ?? ""} ${e.id}`}
                      onSelect={() => {
                        url.set({ employee: e.id });
                        setOpen(false);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{e.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          <span className="font-mono text-[11px]">{e.code}</span>
                          {e.designation ? ` · ${e.designation}` : ""}
                        </span>
                      </div>
                      <Check className={cn("size-4", selected?.id === e.id ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {employeeId ? (
          <Button variant="ghost" size="icon" className="size-10 shrink-0 sm:size-9" aria-label="Show all employees" onClick={() => url.set({ employee: null })}>
            <X />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
