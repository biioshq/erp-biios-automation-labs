"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addDays, financialYearIST, fromDateInput, startOfMonthIST, toDateInput } from "@/lib/dates";
import { formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocal = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Month and financial-year ends, the days a balance sheet is usually read on. */
function presets() {
  const today = new Date();
  const fy = financialYearIST(today);
  return [
    { label: "Today", value: toDateInput(today) },
    { label: "End of last month", value: toDateInput(addDays(startOfMonthIST(today), -1)) },
    { label: `End of ${financialYearIST(addDays(fy.start, -1)).label}`, value: toDateInput(addDays(fy.start, -1)) },
  ];
}

/** One "yyyy-mm-dd" day for reports read as of a date; empty means today. */
export function AsOfFilter({ value, onChange, className }: { value: string | null; onChange: (day: string | null) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const today = toDateInput(new Date());
  const shown = value && value < today ? value : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 font-normal max-md:h-10", className)}>
          <CalendarDays className="opacity-60" />
          As of {shown ? formatDateShort(fromDateInput(shown)) : "today"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto max-w-[calc(100vw-1rem)] flex-col gap-0 p-0 sm:flex-row" align="start">
        <div className="flex flex-wrap gap-1 border-b p-2 sm:w-44 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
          {presets().map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              className="justify-start font-normal"
              onClick={() => {
                onChange(p.value === today ? null : p.value);
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={shown ? toLocal(shown) : undefined}
          defaultMonth={shown ? toLocal(shown) : undefined}
          disabled={{ after: new Date() }}
          onSelect={(d) => {
            if (!d) return;
            const day = localDay(d);
            onChange(day >= today ? null : day);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
