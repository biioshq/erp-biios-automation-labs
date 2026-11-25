"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarHeart, ChevronLeft, ChevronRight, Lock, Plus, Trash2 } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { DateField, TextField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { WEEKDAYS } from "../../constants";
import { holidaySchema } from "../../schemas";
import { dayKind, weekdayOf } from "../../salary/calc";
import { addHoliday, deleteHoliday } from "../actions";

type HolidayInput = z.input<typeof holidaySchema>;
type HolidayValues = z.output<typeof holidaySchema>;

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const NO_HOLIDAYS = new Map<string, string>();

/** The year's company holidays: list, add and delete (add and delete need `canEdit`). */
export function HolidaysPanel({
  year,
  thisYear,
  holidays,
  lockedMonths,
  weeklyOffs,
  offSaturdays,
  canEdit,
}: {
  year: number;
  thisYear: number;
  holidays: { id: string; date: string; name: string }[];
  /** Months ("YYYY-MM") with a finalised salary: their holidays cannot change. */
  lockedMonths: string[];
  weeklyOffs: number[];
  offSaturdays: number[];
  canEdit: boolean;
}) {
  const locked = new Set(lockedMonths);
  const count = holidays.length;
  return (
    <Section
      title={`Holidays in ${year}`}
      description="Paid days off for everyone. They are not working days, so nobody is marked absent on them."
      actions={<YearNav year={year} thisYear={thisYear} />}
      className="min-w-0"
      contentClassName="space-y-4"
    >
      {canEdit ? <AddHolidayForm year={year} /> : null}

      {count ? (
        <>
          <p className="text-xs text-muted-foreground">
            {formatNumber(count)} {count === 1 ? "holiday" : "holidays"}
          </p>
          <ul className="divide-y rounded-lg border">
            {holidays.map((h) => {
              const weekday = WEEKDAYS[weekdayOf(h.date)];
              const isLocked = locked.has(h.date.slice(0, 7));
              const alsoOff = dayKind(h.date, { weeklyOffs, offSaturdays }, NO_HOLIDAYS).kind === "week_off";
              return (
                <li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex w-11 shrink-0 flex-col items-center rounded-md border bg-muted/40 py-1 leading-none" aria-hidden>
                    <span className="tabular text-base font-semibold">{h.date.slice(8, 10)}</span>
                    <span className="mt-0.5 text-[10px] text-muted-foreground uppercase">{fromMonth(h.date)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={h.name}>
                      {h.name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {weekday?.label}, {formatDate(fromDateInput(h.date))}
                      </span>
                      {alsoOff ? (
                        <StatusBadge tone="warning" className="h-5 px-2 text-[11px]">
                          Also a weekly off
                        </StatusBadge>
                      ) : null}
                    </p>
                  </div>
                  {isLocked ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="The salary for this month is finalised">
                      <Lock className="size-3.5" aria-hidden />
                      <span className="sr-only sm:not-sr-only">Finalised</span>
                    </span>
                  ) : canEdit ? (
                    <DeleteHoliday id={h.id} name={h.name} date={h.date} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          compact
          icon={CalendarHeart}
          title={`No holidays in ${year}`}
          description={canEdit ? "Add the company's holidays so nobody is marked absent on them." : "Nobody has added holidays for this year."}
        />
      )}
    </Section>
  );
}

/** "Nov" for "2026-11-19", without the browser's time zone. */
function fromMonth(date: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(date.slice(5, 7)) - 1] ?? "";
}

function YearNav({ year, thisYear }: { year: number; thisYear: number }) {
  return (
    <div className="flex items-center gap-1">
      {year > MIN_YEAR ? (
        <Button asChild variant="outline" size="icon" className="size-8" aria-label={`Holidays in ${year - 1}`}>
          <Link href={`?year=${year - 1}`} scroll={false}>
            <ChevronLeft />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-8" disabled aria-label="Previous year">
          <ChevronLeft />
        </Button>
      )}
      <span className="tabular min-w-12 text-center text-sm font-medium">{year}</span>
      {year < MAX_YEAR ? (
        <Button asChild variant="outline" size="icon" className="size-8" aria-label={`Holidays in ${year + 1}`}>
          <Link href={`?year=${year + 1}`} scroll={false}>
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-8" disabled aria-label="Next year">
          <ChevronRight />
        </Button>
      )}
      {year !== thisYear ? (
        <Button asChild variant="ghost" size="sm" className="h-8">
          <Link href={`?year=${thisYear}`} scroll={false}>
            This year
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function AddHolidayForm({ year }: { year: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<HolidayInput, unknown, HolidayValues>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { date: "", name: "" },
    ...formValidation,
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await addHoliday(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      form.reset({ date: "", name: "" });
      toast.success(result.message ?? "Holiday added");
      emitDataChanged();
      const addedYear = Number(values.date.slice(0, 4));
      if (addedYear !== year) router.push(`?year=${addedYear}`, { scroll: false });
    });
  });

  return (
    <form onSubmit={submit} noValidate className="@container rounded-lg border bg-surface/40 p-3" aria-label="Add a holiday">
      <div className="grid gap-3 @lg:grid-cols-[11rem_minmax(0,1fr)_auto] @lg:items-start">
        <DateField control={form.control} name="date" label="Date" required />
        <TextField control={form.control} name="name" label="Name" required placeholder="Diwali" />
        <Button type="submit" disabled={pending} className="h-10 @lg:mt-[1.6rem] @lg:h-9">
          {pending ? <Spinner /> : <Plus />}
          Add holiday
        </Button>
      </div>
    </form>
  );
}

function DeleteHoliday({ id, name, date }: { id: string; name: string; date: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground hover:text-danger" aria-label={`Delete ${name}`}>
          <Trash2 />
        </Button>
      }
      title={`Delete ${name}?`}
      description={`${formatDate(fromDateInput(date))} becomes a working day again (or a weekly off, by the rules). Attendance already marked on that day stays as it is.`}
      confirmLabel="Delete holiday"
      onConfirm={async () => {
        const result = await deleteHoliday({ id });
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        toast.success(result.message ?? "Holiday deleted");
        emitDataChanged();
      }}
    />
  );
}
