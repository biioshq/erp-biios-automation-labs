"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DateRangeFilter, useTableUrl } from "@/components/data-table";
import { ReportFilterBar, type ReportFilterOptions } from "@/features/reports/components/report-filters";
import type { ReportFilters } from "@/features/reports/types";
import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocal = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** One day with previous and next buttons, for reading the books a day at a time. */
function DayPicker({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  const [open, setOpen] = useState(false);
  const today = toDateInput(new Date());
  const step = (n: number) => onChange(toDateInput(addDays(fromDateInput(day), n)));
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" className="size-8 max-md:size-10" aria-label="Previous day" onClick={() => step(-1)}>
        <ChevronLeft />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 font-normal max-md:h-10">
            <CalendarDays className="opacity-60" />
            {formatDate(fromDateInput(day))}
            {day === today ? <span className="text-muted-foreground">(today)</span> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] p-0" align="start">
          <div className="flex gap-1 border-b p-2">
            <Button
              variant="ghost"
              size="sm"
              className="font-normal"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="font-normal"
              onClick={() => {
                onChange(toDateInput(addDays(new Date(), -1)));
                setOpen(false);
              }}
            >
              Yesterday
            </Button>
          </div>
          <Calendar
            mode="single"
            selected={toLocal(day)}
            defaultMonth={toLocal(day)}
            onSelect={(d) => {
              if (!d) return;
              onChange(localDay(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon" className="size-8 max-md:size-10" aria-label="Next day" onClick={() => step(1)}>
        <ChevronRight />
      </Button>
    </div>
  );
}

/**
 * Day or range, plus project, vendor and category. All of it lives in the URL (?day, or ?from and ?to,
 * then ?project, ?vendor, ?category), so a view can be shared and the server renders the figures for it.
 */
export function DailyControls({
  mode,
  day,
  from,
  to,
  filters,
  options,
}: {
  mode: "day" | "range";
  day: string;
  from: string;
  to: string;
  filters: Pick<ReportFilters, "project" | "vendor" | "category">;
  options: ReportFilterOptions;
}) {
  const url = useTableUrl();
  const today = toDateInput(new Date());
  // The calendar picks the start first; the range applies once both days are chosen.
  const [draft, setDraft] = useState<{ from: string | null; to: string | null } | null>(null);
  const barFilters = { ...filters, from: null, to: null } as ReportFilters;
  return (
    <div className={cn("flex flex-col gap-2 transition-opacity", url.isPending && "opacity-60")} aria-busy={url.isPending}>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={mode}
          onValueChange={(v) => {
            if (!v || v === mode) return;
            if (v === "day") url.set({ day: to === today ? null : to, from: null, to: null });
            else url.set({ day: null, from: toDateInput(addDays(fromDateInput(to), -6)), to });
          }}
          aria-label="Day or range"
        >
          <ToggleGroupItem value="day" className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
            One day
          </ToggleGroupItem>
          <ToggleGroupItem value="range" className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
            Range
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "day" ? (
          <DayPicker day={day} onChange={(d) => url.set({ day: d === today ? null : d, from: null, to: null })} />
        ) : (
          <DateRangeFilter
            from={draft ? draft.from : from}
            to={draft ? draft.to : to}
            label="Date range"
            onChange={(r) => {
              if (r.from && r.to) {
                setDraft(null);
                url.set({ day: null, from: r.from, to: r.to });
              } else if (r.from) setDraft(r);
              else setDraft(null);
            }}
          />
        )}
      </div>
      <ReportFilterBar
        meta={{ type: "daily", filters: ["project", "vendor", "category"], categories: "expense" }}
        filters={barFilters}
        options={options}
        only={["project", "vendor", "category"]}
      />
    </div>
  );
}
