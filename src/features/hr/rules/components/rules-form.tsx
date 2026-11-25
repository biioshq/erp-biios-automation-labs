"use client";

import { useId, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarOff, CalendarX, Clock, Info, Plus, Save, Trash2, Wallet } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { FormSection, NumberField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SALARY_BASES, UNMARKED_RULES, WEEKDAYS, type HrRules } from "../../constants";
import { hrRulesSchema, type HrRulesInput } from "../../schemas";
import { saveHrRules } from "../actions";

type RulesOutput = z.output<typeof hrRulesSchema>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SATURDAYS = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
];
const OVERTIME_PRESETS = [
  { value: 0, label: "Off" },
  { value: 1, label: "1×" },
  { value: 1.5, label: "1.5×" },
  { value: 2, label: "2×" },
];

const dayCount = (n: number) => `${formatNumber(n)} ${n === 1 ? "day" : "days"}`;

/**
 * The attendance rules form. Read only without `canEdit` (the server checks again on save).
 * A leave type whose code is on attendance marks keeps its code and cannot be removed here; the
 * save action refuses it too.
 */
export function RulesForm({
  rules,
  saved,
  leaveUsage,
  canEdit,
}: {
  rules: HrRules;
  saved: boolean;
  leaveUsage: Record<string, number>;
  canEdit: boolean;
}) {
  const readOnly = !canEdit;
  const [pending, startTransition] = useTransition();
  const form = useForm<HrRulesInput, unknown, RulesOutput>({
    resolver: zodResolver(hrRulesSchema),
    defaultValues: rules,
    ...formValidation,
  });
  const { control, formState } = form;
  const leaveTypes = useFieldArray({ control, name: "leaveTypes" });

  const submit = form.handleSubmit((values) => {
    if (readOnly) return;
    startTransition(async () => {
      const result = await saveHrRules(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      form.reset(values);
      toast.success(result.message ?? "Attendance rules saved");
      emitDataChanged();
    });
  });

  const dirty = formState.isDirty;
  // List-level errors: too many types, or a code the server says is still in use.
  const leaveTypesError = formState.errors.leaveTypes?.message ?? formState.errors.leaveTypes?.root?.message;
  const canSave = canEdit && !pending && (dirty || !saved);

  return (
    <form onSubmit={submit} noValidate className="min-w-0 space-y-5" aria-label="Attendance rules">
      <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        <FormSection title="Office hours" icon={<Clock />} description="India time. Used to flag late arrivals and to suggest a status from the in and out times." className="min-w-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <TimeField control={control} name="workStart" label="Office starts" disabled={readOnly} />
            <TimeField control={control} name="workEnd" label="Office ends" disabled={readOnly} />
            <NumberField
              control={control}
              name="graceMinutes"
              label="Grace time"
              suffix="min"
              step={1}
              description="An arrival after the start time plus this counts as late."
              disabled={readOnly}
              className="sm:col-span-2"
            />
            <NumberField
              control={control}
              name="fullDayHours"
              label="Hours for a full day"
              suffix="hours"
              step={0.5}
              description="Overtime counts after this."
              disabled={readOnly}
            />
            <NumberField
              control={control}
              name="halfDayHours"
              label="Hours for a half day"
              suffix="hours"
              step={0.5}
              description="Fewer hours than this suggests absent."
              disabled={readOnly}
            />
          </div>
          <NightShiftNote control={control} />
        </FormSection>

        <FormSection title="Weekly offs" icon={<CalendarOff />} description="Days nobody works. They are not working days and are never marked absent." className="min-w-0">
          <WeeklyOffs control={control} disabled={readOnly} />
        </FormSection>

        <FormSection title="Salary" icon={<Wallet />} description="How a month's salary is worked out from attendance." className="min-w-0">
          <RadioCards
            control={control}
            name="salaryBasis"
            legend="Salary per day"
            options={SALARY_BASES}
            disabled={readOnly}
          />
          <RadioCards
            control={control}
            name="unmarkedDays"
            legend="Working days nobody marked"
            options={UNMARKED_RULES}
            disabled={readOnly}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={control}
              name="lateMarksPerHalfDay"
              label="Late arrivals per half day of pay"
              suffix="late"
              step={1}
              description="Every this many late arrivals in a month cost half a day's salary. 0 turns this off."
              disabled={readOnly}
            />
            <OvertimeField
              control={control}
              disabled={readOnly}
              onPick={(rate) => form.setValue("overtimeRate", rate, { shouldDirty: true, shouldValidate: formState.isSubmitted })}
            />
          </div>
        </FormSection>

        <FormSection title="Leave" icon={<CalendarX />} description="Leave types HR can record, and when the leave year starts for yearly allowances." className="min-w-0">
          <LeaveYearField control={control} disabled={readOnly} />
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium">Leave types</p>
                <p className="text-xs text-muted-foreground">Paid leave keeps the day&apos;s salary while the yearly allowance lasts. Leave the allowance blank for no limit.</p>
              </div>
            </div>
            <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_8.5rem_4.5rem_2.25rem] gap-3 px-3 text-xs font-medium text-muted-foreground sm:grid">
              <span>Code</span>
              <span>Name</span>
              <span>Yearly allowance</span>
              <span>Paid</span>
              <span className="sr-only">Remove</span>
            </div>
            <LeaveTypeRows control={control} fields={leaveTypes.fields} remove={leaveTypes.remove} leaveUsage={leaveUsage} readOnly={readOnly} />
            <MissingLeaveCodes
              control={control}
              leaveUsage={leaveUsage}
              readOnly={readOnly}
              full={leaveTypes.fields.length >= 20}
              onAdd={(code) => leaveTypes.append({ code, name: code, paid: true, yearlyQuota: null })}
            />
            {leaveTypesError ? <p className="text-xs text-danger">{leaveTypesError}</p> : null}
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => leaveTypes.append({ code: "", name: "", paid: true, yearlyQuota: null })}
                disabled={leaveTypes.fields.length >= 20}
              >
                <Plus /> Add leave type
              </Button>
            ) : null}
          </div>
        </FormSection>
      </fieldset>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        Changes apply to every month whose salary is not finalised yet. A finalised month keeps the rules it was finalised with until it is reopened.
      </p>

      {canEdit ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card backdrop-blur">
          <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
            {dirty ? "Unsaved changes" : saved ? "No unsaved changes" : "Save to keep these rules"}
          </p>
          <Button type="button" variant="outline" onClick={() => form.reset()} disabled={pending || !dirty}>
            Discard changes
          </Button>
          <Button type="submit" disabled={!canSave} className="min-w-32">
            {pending ? <Spinner /> : <Save />}
            Save rules
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** "HH:mm" with the browser's time picker. */
function TimeField({ control, name, label, disabled }: { control: Control<HrRulesInput>; name: "workStart" | "workEnd"; label: string; disabled?: boolean }) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
          <FieldLabel htmlFor={id} className="text-[13px]">
            {label}
          </FieldLabel>
          <Input
            id={id}
            type="time"
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={field.value ?? ""}
            onChange={(e) => field.onChange(e.target.value.slice(0, 5))}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
            className="tabular"
          />
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
        </Field>
      )}
    />
  );
}

function NightShiftNote({ control }: { control: Control<HrRulesInput> }) {
  const [start, end] = useWatch({ control, name: ["workStart", "workEnd"] });
  if (!start || !end || end >= start) return null;
  return <p className="text-xs text-muted-foreground">The office end time is before the start time, so the day ends after midnight (a night shift).</p>;
}

function toggle(list: number[] | undefined, value: number, on: boolean): number[] {
  const next = new Set(list ?? []);
  if (on) next.add(value);
  else next.delete(value);
  return [...next].sort((a, b) => a - b);
}

function WeeklyOffs({ control, disabled }: { control: Control<HrRulesInput>; disabled?: boolean }) {
  const weeklyOffs = useWatch({ control, name: "weeklyOffs" });
  const saturdayOff = (weeklyOffs ?? []).includes(6);
  const groupId = useId();
  return (
    <div className="space-y-4">
      <Controller
        control={control}
        name="weeklyOffs"
        render={({ field, fieldState }) => (
          <div role="group" aria-labelledby={`${groupId}-week`} className="space-y-2">
            <p id={`${groupId}-week`} className="text-[13px] font-medium">
              Off every week
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEKDAYS.map((d) => {
                const checked = (field.value ?? []).includes(d.value);
                return (
                  <label
                    key={d.value}
                    className={cn(
                      "flex min-h-10 items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-sm",
                      disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer",
                      checked && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => field.onChange(toggle(field.value, d.value, v === true))} />
                    {d.label}
                  </label>
                );
              })}
            </div>
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
          </div>
        )}
      />
      <Controller
        control={control}
        name="offSaturdays"
        render={({ field }) => (
          <div role="group" aria-labelledby={`${groupId}-sat`} className="space-y-2">
            <div>
              <p id={`${groupId}-sat`} className="text-[13px] font-medium">
                Saturdays off in the month
              </p>
              <p className="text-xs text-muted-foreground">
                {saturdayOff ? "Every Saturday is already off." : "For example the 2nd and 4th Saturday. Counted from the start of the month."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {SATURDAYS.map((s) => {
                const checked = (field.value ?? []).includes(s.value);
                const off = disabled || saturdayOff;
                return (
                  <label
                    key={s.value}
                    className={cn(
                      "flex min-h-10 items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-sm",
                      off ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      checked && !saturdayOff && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <Checkbox
                      checked={checked || saturdayOff}
                      disabled={off}
                      aria-label={`${s.label} Saturday`}
                      onCheckedChange={(v) => field.onChange(toggle(field.value, s.value, v === true))}
                    />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      />
    </div>
  );
}

function RadioCards({
  control,
  name,
  legend,
  options,
  disabled,
}: {
  control: Control<HrRulesInput>;
  name: "salaryBasis" | "unmarkedDays";
  legend: string;
  options: readonly { value: string; label: string; description: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="space-y-2">
          <p id={`${id}-legend`} className="text-[13px] font-medium">
            {legend}
          </p>
          <RadioGroup
            aria-labelledby={`${id}-legend`}
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
            className={cn("grid gap-2", options.length > 2 ? "md:grid-cols-3" : "sm:grid-cols-2")}
          >
            {options.map((o) => (
              <label
                key={o.value}
                htmlFor={`${id}-${o.value}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border bg-card p-3 has-[[aria-checked=true]]:border-primary/60 has-[[aria-checked=true]]:bg-primary/5",
                  disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer",
                )}
              >
                <RadioGroupItem id={`${id}-${o.value}`} value={o.value} className="mt-0.5" />
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-pretty text-muted-foreground">{o.description}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
        </div>
      )}
    />
  );
}

function OvertimeField({ control, disabled, onPick }: { control: Control<HrRulesInput>; disabled?: boolean; onPick: (rate: number) => void }) {
  const rate = useWatch({ control, name: "overtimeRate" });
  return (
    <div className="space-y-2">
      <NumberField
        control={control}
        name="overtimeRate"
        label="Overtime pay"
        suffix="× hourly rate"
        step={0.25}
        description="Hours past a full day, paid at this many times the hourly rate. 0 turns overtime pay off."
        disabled={disabled}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Overtime presets">
        {OVERTIME_PRESETS.map((p) => (
          <Button
            key={p.value}
            type="button"
            size="sm"
            variant={rate === p.value ? "secondary" : "outline"}
            aria-pressed={rate === p.value}
            className="h-8 min-w-12"
            disabled={disabled}
            onClick={() => onPick(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function LeaveYearField({ control, disabled }: { control: Control<HrRulesInput>; disabled?: boolean }) {
  const id = useId();
  return (
    <Controller
      control={control}
      name="leaveYearStartMonth"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5 sm:max-w-xs">
          <FieldLabel htmlFor={id} className="text-[13px]">
            Leave year starts in
          </FieldLabel>
          <Select value={field.value ? String(field.value) : ""} onValueChange={(v) => field.onChange(Number(v))} disabled={disabled}>
            <SelectTrigger id={id} ref={field.ref} onBlur={field.onBlur} aria-invalid={fieldState.invalid} className="w-full">
              <SelectValue placeholder="Pick a month" />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs">Yearly leave allowances start again in this month. January for the calendar year, April for the financial year.</FieldDescription>
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
        </Field>
      )}
    />
  );
}

function LeaveTypeRows({
  control,
  fields,
  remove,
  leaveUsage,
  readOnly,
}: {
  control: Control<HrRulesInput>;
  fields: { id: string }[];
  remove: (index: number) => void;
  leaveUsage: Record<string, number>;
  readOnly: boolean;
}) {
  const current = useWatch({ control, name: "leaveTypes" }) ?? [];
  const id = useId();
  if (!fields.length) {
    return <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No leave types. Leave cannot be recorded until there is at least one.</p>;
  }
  return (
    <ul className="space-y-2">
      {fields.map((f, index) => {
        const code = (current[index]?.code ?? "").trim().toUpperCase();
        // The first row with a code that attendance uses keeps that code and stays in the list.
        const firstWithCode = current.findIndex((t) => (t?.code ?? "").trim().toUpperCase() === code) === index;
        const used = code && firstWithCode ? (leaveUsage[code] ?? 0) : 0;
        const rowLabel = current[index]?.name || code || `Leave type ${index + 1}`;
        return (
          <li key={f.id} className="rounded-lg border bg-card p-3 sm:py-2">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_8.5rem_4.5rem_2.25rem] sm:items-start">
              <Controller
                control={control}
                name={`leaveTypes.${index}.code`}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined} className="gap-1">
                    <FieldLabel htmlFor={`${id}-${f.id}-code`} className="text-xs sm:sr-only">
                      Code
                    </FieldLabel>
                    <Input
                      id={`${id}-${f.id}-code`}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      readOnly={Boolean(used)}
                      aria-readonly={Boolean(used) || undefined}
                      maxLength={12}
                      placeholder="CL"
                      autoCapitalize="characters"
                      aria-invalid={fieldState.invalid}
                      className={cn("font-mono text-[13px] uppercase", used && "bg-muted/60 text-muted-foreground")}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name={`leaveTypes.${index}.name`}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined} className="col-span-2 row-start-2 gap-1 sm:col-span-1 sm:row-start-auto">
                    <FieldLabel htmlFor={`${id}-${f.id}-name`} className="text-xs sm:sr-only">
                      Name
                    </FieldLabel>
                    <Input
                      id={`${id}-${f.id}-name`}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      maxLength={60}
                      placeholder="Casual leave"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
                  </Field>
                )}
              />
              <QuotaInput control={control} index={index} inputId={`${id}-${f.id}-quota`} />
              <Controller
                control={control}
                name={`leaveTypes.${index}.paid`}
                render={({ field }) => (
                  <div className="col-span-1 row-start-3 flex min-h-9 items-center gap-2 sm:row-start-auto">
                    <Switch
                      id={`${id}-${f.id}-paid`}
                      checked={Boolean(field.value)}
                      onCheckedChange={field.onChange}
                      disabled={readOnly}
                      aria-label={`${rowLabel} is paid`}
                    />
                    <label htmlFor={`${id}-${f.id}-paid`} className="text-sm">
                      {field.value ? "Paid" : "Unpaid"}
                    </label>
                  </div>
                )}
              />
              {readOnly ? (
                <span className="hidden sm:block" />
              ) : (
                <div className="col-span-1 row-start-3 flex justify-end sm:row-start-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-danger"
                    onClick={() => remove(index)}
                    disabled={Boolean(used)}
                    aria-label={used ? `${rowLabel} is in use and cannot be removed` : `Remove ${rowLabel}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>
            {used && !readOnly ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Used on {dayCount(used)} of attendance, so the code stays and the type cannot be removed. You can still change its name, pay and allowance.
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Leave codes on attendance marks that are not in the list (removed from the rules some other
 * way, or removed in this form). The save refuses them, so say which ones and offer to add them back.
 */
function MissingLeaveCodes({
  control,
  leaveUsage,
  readOnly,
  full,
  onAdd,
}: {
  control: Control<HrRulesInput>;
  leaveUsage: Record<string, number>;
  readOnly: boolean;
  full: boolean;
  onAdd: (code: string) => void;
}) {
  const current = useWatch({ control, name: "leaveTypes" }) ?? [];
  const listed = new Set(current.map((t) => (t?.code ?? "").trim().toUpperCase()));
  const missing = Object.entries(leaveUsage)
    .filter(([code, days]) => code && days > 0 && !listed.has(code))
    .sort(([a], [b]) => a.localeCompare(b));
  if (!missing.length) return null;
  return (
    <div role="status" className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs">
      <p>
        Attendance uses {missing.length === 1 ? "a leave code" : "leave codes"} that {missing.length === 1 ? "is" : "are"} not in this list.
        {readOnly ? "" : missing.length === 1 ? " Add it back before saving: the rules cannot be saved without it." : " Add them back before saving: the rules cannot be saved without them."}
      </p>
      <ul className="flex flex-wrap gap-2">
        {missing.map(([code, days]) => (
          <li key={code} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1">
            <span className="font-mono">{code}</span>
            <span className="text-muted-foreground">{dayCount(days)}</span>
            {readOnly ? null : (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={full} onClick={() => onAdd(code)} aria-label={`Add ${code} back`}>
                <Plus /> Add back
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Days a year; blank means no limit (null), which the shared number field cannot express. */
function QuotaInput({ control, index, inputId }: { control: Control<HrRulesInput>; index: number; inputId: string }) {
  return (
    <Controller
      control={control}
      name={`leaveTypes.${index}.yearlyQuota`}
      render={({ field, fieldState }) => {
        const value = field.value as number | null | undefined;
        return (
          <Field data-invalid={fieldState.invalid || undefined} className="gap-1">
            <FieldLabel htmlFor={inputId} className="text-xs sm:sr-only">
              Yearly allowance
            </FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={inputId}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                type="number"
                inputMode="decimal"
                min={0}
                max={366}
                step={0.5}
                value={value === null || value === undefined || Number.isNaN(value) ? "" : value}
                onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                placeholder="No limit"
                aria-invalid={fieldState.invalid}
                className="tabular"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>days</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
          </Field>
        );
      }}
    />
  );
}
