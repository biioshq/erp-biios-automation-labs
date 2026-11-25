"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarRange, CircleAlert, Info, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { ComboboxField, DateField, SelectField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { FormSheet, FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { attendanceStatusLabel, WEEKDAYS, type LeaveType } from "../../constants";
import { leaveFormSchema, type LeaveFormInput, type LeaveFormValues } from "../../schemas";
import { weekdayOf } from "../../salary/calc";
import { previewLeave, recordLeave } from "../actions";
import type { LeaveEmployeeOption, LeavePlan } from "../types";
import { dayLabel, daysLabel } from "./leave-bits";

const monthName = (month: string) =>
  new Date(`${month}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

const shortDay = (date: string) => `${WEEKDAYS[weekdayOf(date)]?.short ?? ""} ${dayLabel(date)}`;

/** The record leave panel, opened by ?new=1. */
export function LeaveSheet({
  employees,
  leaveTypes,
  today,
  canReplace,
}: {
  employees: LeaveEmployeeOption[];
  leaveTypes: LeaveType[];
  /** "YYYY-MM-DD" in India. */
  today: string;
  /** The role can change attendance already marked (hr.attendance:edit), so leave can replace those marks. */
  canReplace: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams.get("new") === "1";
  const preset = searchParams.get("employee");

  const close = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <FormSheet open={open} onOpenChange={(o) => !o && close()} title="Record leave" description="Marks each day of the leave on the attendance register.">
      {open ? (
        <LeaveForm
          employees={employees}
          leaveTypes={leaveTypes}
          today={today}
          canReplace={canReplace}
          presetEmployee={preset && employees.some((e) => e.id === preset) ? preset : undefined}
          onDone={close}
        />
      ) : null}
    </FormSheet>
  );
}

type Preview = { key: string; plan: LeavePlan | null; error: string | null };

function LeaveForm({
  employees,
  leaveTypes,
  today,
  canReplace,
  presetEmployee,
  onDone,
}: {
  employees: LeaveEmployeeOption[];
  leaveTypes: LeaveType[];
  today: string;
  canReplace: boolean;
  presetEmployee?: string;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<LeaveFormInput, unknown, LeaveFormValues>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: {
      employeeId: presetEmployee ?? "",
      leaveType: leaveTypes.length === 1 ? leaveTypes[0].code : "",
      from: today,
      to: today,
      halfDay: false,
      skipOffDays: true,
      overwrite: false,
      reason: "",
    },
    ...formValidation,
  });
  const control = form.control as unknown as Control<LeaveFormInput>;
  const { setValue, getValues } = form;
  const [employeeId, leaveType, from, to, halfDay, skipOffDays] = useWatch({
    control,
    name: ["employeeId", "leaveType", "from", "to", "halfDay", "skipOffDays"],
  });
  const oneDay = Boolean(from) && from === to;

  // The last day follows the first when it would fall before it; a range cannot be half a day.
  useEffect(() => {
    if (!from) return;
    const current = getValues("to");
    if (!current || current < from) setValue("to", from, { shouldValidate: form.formState.isSubmitted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);
  useEffect(() => {
    if (!oneDay && getValues("halfDay")) setValue("halfDay", false);
  }, [oneDay, getValues, setValue]);

  // Ask the server what this leave would record, a moment after the inputs settle.
  const ready = Boolean(employeeId && leaveType && from && to && to >= from);
  const key = JSON.stringify([employeeId, leaveType, from, to, Boolean(halfDay && oneDay), skipOffDays !== false]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    if (!ready) return;
    const handle = window.setTimeout(async () => {
      const result = await previewLeave({
        employeeId: employeeId as string,
        leaveType: leaveType as string,
        from: from as string,
        to: to as string,
        halfDay: Boolean(halfDay && oneDay),
        skipOffDays: skipOffDays !== false,
      });
      if (latest.current !== key) return;
      setPreview(result.ok ? { key, plan: result.data, error: null } : { key, plan: null, error: result.error });
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  const current = ready && preview?.key === key ? preview : null;
  const loading = ready && !current;

  // A save that stopped on days already marked: offer to replace them.
  const [conflict, setConflict] = useState<{ key: string; message: string } | null>(null);
  const conflictMessage = conflict?.key === key ? conflict.message : null;
  const hasConflicts = Boolean(conflictMessage || current?.plan?.conflicts.length);
  const nothingToRecord = Boolean(current?.plan && !current.plan.days.length);
  const locked = Boolean(current?.plan?.lockedMonths.length);

  const save = (overwrite: boolean) =>
    form.handleSubmit((values) => {
      startTransition(async () => {
        const result = await recordLeave({ ...values, halfDay: values.halfDay && values.from === values.to, overwrite });
        if (!result.ok) {
          if (result.fieldErrors?.overwrite) {
            setConflict({ key, message: result.error });
            return;
          }
          applyFieldErrors(result, form.setError);
          toast.error(result.error);
          return;
        }
        const d = result.data;
        const notes = [
          d.replaced ? `${d.replaced} ${d.replaced === 1 ? "mark" : "marks"} replaced` : null,
          d.skippedOff ? `${d.skippedOff} weekly ${d.skippedOff === 1 ? "off or holiday" : "offs and holidays"} left out` : null,
        ].filter(Boolean);
        toast.success(`${daysLabel(d.units)} of ${d.typeName.toLowerCase()} recorded for ${d.employeeName}`, {
          description: notes.length ? `${notes.join(", ")}.` : undefined,
        });
        emitDataChanged();
        onDone();
      });
    });

  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: e.name,
    description: [e.code, e.designation, e.exitDate ? `left ${dayLabel(e.exitDate)}` : null].filter(Boolean).join(" · "),
  }));
  const typeOptions = leaveTypes.map((t) => ({
    value: t.code,
    label: `${t.name} (${t.code}), ${t.paid ? "paid" : "unpaid"}${t.yearlyQuota === null ? "" : `, ${formatNumber(t.yearlyQuota)} days a year`}`,
  }));

  if (!leaveTypes.length) {
    return (
      <FormSheetBody>
        <p className="text-sm text-muted-foreground">There are no leave types in the attendance rules yet. Add them on the Rules tab, then record leave here.</p>
      </FormSheetBody>
    );
  }

  return (
    <form onSubmit={save(false)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody>
        <div className="space-y-4">
          <ComboboxField
            control={control}
            name="employeeId"
            label="Employee"
            required
            options={employeeOptions}
            placeholder="Pick a person"
            searchPlaceholder="Search people…"
            emptyText="Nobody found."
          />
          <SelectField control={control} name="leaveType" label="Leave type" required options={typeOptions} placeholder="Pick the leave type" />
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name="from" label="From" required />
            <DateField control={control} name="to" label="To" required />
          </div>

          <div className="space-y-2">
            {oneDay ? (
              <Controller
                control={control}
                name="halfDay"
                render={({ field }) => (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3.5 py-3">
                    <Checkbox checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium">Half a day</span>
                      <span className="block text-xs text-pretty text-muted-foreground">The other half is worked. The day is marked as a half day with this leave type.</span>
                    </span>
                  </label>
                )}
              />
            ) : null}
            <Controller
              control={control}
              name="skipOffDays"
              render={({ field }) => (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card px-3.5 py-3">
                  <Checkbox checked={field.value !== false} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">Leave out weekly offs and holidays</span>
                    <span className="block text-xs text-pretty text-muted-foreground">Only working days get a leave mark, so they do not use up the allowance.</span>
                  </span>
                </label>
              )}
            />
          </div>

          <TextareaField control={control} name="reason" label="Reason" placeholder="Family function, fever" rows={2} />

          <PreviewPanel loading={loading} preview={current} conflictMessage={conflictMessage} canReplace={canReplace} />
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending} className="h-10 sm:h-9">
          Cancel
        </Button>
        {hasConflicts && !canReplace ? (
          <Button type="button" disabled className="h-10 min-w-32 sm:h-9">
            Record leave
          </Button>
        ) : hasConflicts ? (
          <Button type="button" variant="destructive" onClick={save(true)} disabled={pending || nothingToRecord || locked} className="h-10 min-w-32 sm:h-9">
            {pending ? <Spinner /> : null}
            Replace those marks
          </Button>
        ) : (
          <Button type="submit" disabled={pending || nothingToRecord || locked} className="h-10 min-w-32 sm:h-9">
            {pending ? <Spinner /> : null}
            Record leave
          </Button>
        )}
      </FormSheetFooter>
    </form>
  );
}

function Note({ tone, icon: Icon, children }: { tone: "info" | "warning" | "danger"; icon: typeof Info; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs text-pretty",
        tone === "info" && "border-border bg-muted/40 text-muted-foreground",
        tone === "warning" && "border-warning/30 bg-warning/8 text-foreground",
        tone === "danger" && "border-danger/30 bg-danger/8 text-foreground",
      )}
    >
      <Icon className={cn("mt-px size-3.5 shrink-0", tone === "warning" && "text-warning", tone === "danger" && "text-danger")} aria-hidden />
      <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function listDays(dates: string[], max = 6): string {
  const shown = dates.slice(0, max).join(", ");
  return dates.length > max ? `${shown} and ${dates.length - max} more` : shown;
}

function BalanceBox({ label, used, allowance }: { label: string; used: number; allowance: number | null }) {
  const left = allowance === null ? null : allowance - used;
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      {left === null ? (
        <p className="tabular text-base font-semibold">{formatNumber(used)} used</p>
      ) : (
        <>
          <p className={cn("tabular text-base font-semibold", left < 0 && "text-danger")}>{left < 0 ? `Over by ${formatNumber(-left)}` : `${formatNumber(left)} left`}</p>
          <p className="tabular text-xs text-muted-foreground">
            {formatNumber(used)} of {formatNumber(allowance ?? 0)} used
          </p>
        </>
      )}
    </div>
  );
}

function PreviewPanel({
  loading,
  preview,
  conflictMessage,
  canReplace,
}: {
  loading: boolean;
  preview: Preview | null;
  conflictMessage: string | null;
  canReplace: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground" aria-live="polite">
        <Spinner className="size-3.5" /> Working out the days…
      </div>
    );
  }
  if (!preview) return null;
  if (preview.error) {
    return (
      <Note tone="danger" icon={CircleAlert}>
        <p>{preview.error}</p>
      </Note>
    );
  }
  const plan = preview.plan;
  if (!plan) return null;
  const { balance, type } = plan;
  const half = plan.units === 0.5 && plan.days.length === 1;

  return (
    <section className="space-y-2 rounded-xl border bg-muted/20 p-3" aria-live="polite" aria-label="What will be recorded">
      <div className="flex items-start gap-2">
        <CalendarRange className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          {plan.days.length ? (
            <>
              <p className="text-sm font-semibold">
                {half ? "Half a day" : daysLabel(plan.units)} of {type.name.toLowerCase()}
              </p>
              <p className="tabular text-xs text-muted-foreground">
                {plan.days.length === 1 ? shortDay(plan.days[0]) : `${shortDay(plan.days[0])} to ${shortDay(plan.days[plan.days.length - 1])}`}
                {plan.days.length > 1 ? `, ${plan.days.length} days marked` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm font-semibold">Nothing to record</p>
          )}
        </div>
      </div>

      {plan.lockedMonths.length ? (
        <Note tone="danger" icon={Lock}>
          <p>
            The salary for {plan.lockedMonths.map(monthName).join(" and ")} is finalised, so its attendance is locked. Reopen the month on the Salary tab to record this leave.
          </p>
        </Note>
      ) : null}

      {!plan.days.length ? (
        <Note tone="warning" icon={TriangleAlert}>
          <p>Every day in this range is a weekly off, a holiday or outside {plan.employee.name}&apos;s employment.</p>
        </Note>
      ) : null}

      {conflictMessage || plan.conflicts.length ? (
        <Note tone="warning" icon={TriangleAlert}>
          {plan.conflicts.length ? (
            <p>
              Already marked: {listDays(plan.conflicts.map((c) => `${dayLabel(c.date)} (${attendanceStatusLabel(c.status).toLowerCase()})`))}.{" "}
              {canReplace
                ? `Saving replaces ${plan.conflicts.length === 1 ? "that mark" : "those marks"} with leave.`
                : "Your role cannot change attendance that is already marked. Change the dates, or ask someone who can edit attendance."}
            </p>
          ) : (
            <p>{conflictMessage}</p>
          )}
        </Note>
      ) : null}

      {plan.skippedOff.length ? (
        <Note tone="info" icon={Info}>
          <p>
            Left out: {listDays(plan.skippedOff.map((d) => (d.holidayName ? `${shortDay(d.date)} (${d.holidayName})` : shortDay(d.date))))}.
          </p>
        </Note>
      ) : null}
      {plan.skippedNotEmployed ? (
        <Note tone="info" icon={Info}>
          <p>
            {plan.skippedNotEmployed} {plan.skippedNotEmployed === 1 ? "day falls" : "days fall"} outside {plan.employee.name}&apos;s employment and{" "}
            {plan.skippedNotEmployed === 1 ? "is" : "are"} left out.
          </p>
        </Note>
      ) : null}
      {plan.replacingLeave ? (
        <Note tone="info" icon={Info}>
          <p>
            {plan.replacingLeave} {plan.replacingLeave === 1 ? "day is" : "days are"} already marked as leave and {plan.replacingLeave === 1 ? "is" : "are"} replaced by this one.
          </p>
        </Note>
      ) : null}

      <div className="space-y-1.5 pt-1">
        <p className="text-xs font-medium text-muted-foreground">
          {type.name} in leave year {balance.yearLabel}
          {type.yearlyQuota === null ? ", no yearly limit" : `, ${formatNumber(type.yearlyQuota)} days a year`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <BalanceBox label="Before" used={balance.usedBefore} allowance={balance.allowance} />
          <BalanceBox label="After" used={balance.usedAfter} allowance={balance.allowance} />
        </div>
        {!type.paid ? (
          <p className="text-xs text-muted-foreground">Unpaid leave: these days are not paid.</p>
        ) : balance.allowance !== null && balance.usedAfter > balance.allowance ? (
          <p className="text-xs font-medium text-danger">Days beyond the allowance are not paid.</p>
        ) : null}
        {balance.spansYears ? <p className="text-xs text-muted-foreground">Days after the end of this leave year count in the next one.</p> : null}
      </div>
    </section>
  );
}
