"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, financialYearIST, fromDateInput, startOfMonthIST, toDateInput } from "@/lib/dates";
import { formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocal = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function presets() {
  const today = new Date();
  const fy = financialYearIST(today);
  const lastFy = financialYearIST(addDays(fy.start, -1));
  return [
    { label: "This month", from: toDateInput(startOfMonthIST(today)), to: toDateInput(today) },
    {
      label: "Last month",
      from: toDateInput(startOfMonthIST(today, -1)),
      to: toDateInput(addDays(startOfMonthIST(today), -1)),
    },
    { label: "Last 30 days", from: toDateInput(addDays(today, -29)), to: toDateInput(today) },
    { label: "Last 90 days", from: toDateInput(addDays(today, -89)), to: toDateInput(today) },
    { label: fy.label, from: toDateInput(fy.start), to: toDateInput(fy.end) },
    { label: lastFy.label, from: toDateInput(lastFy.start), to: toDateInput(lastFy.end) },
  ];
}

/** "yyyy-mm-dd" range with presets (months, Indian financial years). */
export function DateRangeFilter({
  from,
  to,
  onChange,
  className,
  label = "Date",
}: {
  from: string | null;
  to: string | null;
  onChange: (range: { from: string | null; to: string | null }) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined = from ? { from: toLocal(from), to: to ? toLocal(to) : undefined } : undefined;
  const text = from ? `${formatDateShort(fromDateInput(from))} – ${to ? formatDateShort(fromDateInput(to)) : "…"}` : label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 font-normal max-md:h-10", !from && "border-dashed", className)}>
          <CalendarRange className="opacity-60" />
          {text}
          {from ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear dates"
              className="-mr-1 rounded p-0.5 hover:bg-muted"
              onClick={(e) => {
                e.stopPropagation();
                onChange({ from: null, to: null });
              }}
            >
              <X className="size-3.5" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex max-h-[min(var(--radix-popover-content-available-height),560px)] w-auto max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-y-auto p-0 sm:flex-row" align="start">
        <div className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
          {presets().map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              className="justify-start font-normal"
              onClick={() => {
                onChange({ from: p.from, to: p.to });
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(range) => onChange({ from: range?.from ? localDay(range.from) : null, to: range?.to ? localDay(range.to) : null })}
          className="hidden sm:block"
        />
        <Calendar
          mode="range"
          numberOfMonths={1}
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(range) => onChange({ from: range?.from ? localDay(range.from) : null, to: range?.to ? localDay(range.to) : null })}
          className="sm:hidden"
        />
      </PopoverContent>
    </Popover>
  );
}
