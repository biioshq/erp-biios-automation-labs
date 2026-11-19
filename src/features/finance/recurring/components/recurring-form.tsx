"use client";

import { useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarClock, FolderKanban, IndianRupee, Sparkles, StickyNote, Tag, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { applyFieldErrors } from "@/lib/action-result";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PROJECT_STAGES, RECURRING_FREQUENCIES } from "@/lib/constants";
import { addDays, fromDateInput, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatDate, round2 } from "@/lib/format";
import { isInterState, splitGst } from "@/lib/gst";
import { firstOccurrence, nextOccurrence, upcomingOccurrences } from "@/lib/recurrence";
import { cn } from "@/lib/utils";
import { GST_RATES } from "@/config/company";
import type { EmployeeOption, ProjectOption } from "@/server/lookups";
import { createRecurring, updateRecurring } from "../actions";
import { ordinal } from "../format";
import { RECURRING_TEMPLATES, recurringFormSchema, type RecurringFormInput, type RecurringFormValues, type RecurringTemplate } from "../schemas";
import type { RecurringDetail } from "../types";
import { formValidation } from "@/components/forms/form-options";

const PAYMENT_OPTIONS = PAYMENT_METHODS.filter((m) => m.value !== "stock");
const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.filter((c) => c.value !== "inventory");
const DAY_OPTIONS = [...Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `${ordinal(i + 1)} of the month` })), { value: 31, label: "Last day of the month" }];

function defaultsFrom(schedule?: RecurringDetail | null, template?: RecurringTemplate | null): RecurringFormInput {
  return {
    name: schedule?.name ?? template?.name ?? "",
    vendor: schedule?.vendor ?? "",
    category: schedule?.category ?? template?.category ?? (undefined as unknown as RecurringFormInput["category"]),
    description: schedule?.description ?? template?.description ?? "",
    amount: schedule?.amount ?? (undefined as unknown as number),
    gstRate: schedule?.gstRate ?? template?.gstRate ?? 0,
    gstin: schedule?.gstin ?? "",
    hsnSac: schedule?.hsnSac ?? "",
    paymentMethod: schedule?.paymentMethod ?? "bank_transfer",
    projectId: schedule?.project?.id ?? undefined,
    stage: schedule?.stage ?? undefined,
    employeeId: schedule?.employee?.id ?? undefined,
    frequency: schedule?.frequency ?? template?.frequency ?? "monthly",
    dayOfMonth: schedule?.dayOfMonth ?? template?.dayOfMonth ?? 1,
    startDate: schedule ? toDateInput(schedule.startDate) : toDateInput(new Date()),
    endDate: schedule?.endDate ? toDateInput(schedule.endDate) : undefined,
    notes: schedule?.notes ?? "",
  };
}

/** The date the server will use as the next due date for the form's current values. */
function previewFirst(values: { startDate?: string; frequency?: RecurringFormInput["frequency"]; dayOfMonth?: number }, schedule?: RecurringDetail | null): Date | null {
  if (!values.startDate || !values.frequency || !values.dayOfMonth) return null;
  const start = fromDateInput(values.startDate);
  const day = values.frequency === "weekly" ? 1 : values.dayOfMonth;
  const first = firstOccurrence(start, values.frequency, day);
  if (!schedule) return first;
  const unchanged =
    values.frequency === schedule.frequency && day === schedule.dayOfMonth && values.startDate === toDateInput(schedule.startDate);
  if (unchanged || schedule.status === "ended") return new Date(schedule.nextRunDate);
  // Changed rhythm: continue from today, never from dates that were already due.
  let from = new Date(Math.max(startOfDayIST().getTime(), start.getTime()));
  // Same rule as the server: a monthly or longer schedule never posts again in the month it last posted.
  if (schedule.lastRunDate) {
    const last = new Date(schedule.lastRunDate);
    const afterLast = schedule.frequency === "weekly" ? addDays(last, 1) : startOfMonthIST(last, 1);
    from = new Date(Math.max(from.getTime(), afterLast.getTime()));
  }
  let candidate = first;
  for (let i = 0; i < 1500 && candidate.getTime() < from.getTime(); i++) candidate = nextOccurrence(candidate, values.frequency, day);
  return candidate;
}

/** Create or edit a recurring schedule: what, amount, schedule, assignment, payment and notes. */
export function RecurringForm({
  schedule,
  template,
  projects,
  vendors,
  employees,
  onDone,
  onCancel,
}: {
  schedule?: RecurringDetail | null;
  template?: string | null;
  projects: ProjectOption[];
  vendors: string[];
  employees: EmployeeOption[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(schedule);
  const [pending, startTransition] = useTransition();
  const [templateKey, setTemplateKey] = useState<string | null>(null);

  const form = useForm<RecurringFormInput, unknown, RecurringFormValues>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: defaultsFrom(schedule, RECURRING_TEMPLATES.find((t) => t.key === template)),
    ...formValidation,
  });
  const { control, setValue, getValues } = form;
  const [amount, gstRate, gstin, frequency, dayOfMonth, startDate, endDate, projectId] = useWatch({
    control,
    name: ["amount", "gstRate", "gstin", "frequency", "dayOfMonth", "startDate", "endDate", "projectId"],
  });

  const tax = useMemo(() => {
    if (!amount || !gstRate) return null;
    // Same rounding as the posted expense (postOccurrence): taxable + tax equals the amount, CGST equals SGST,
    // and the last paisa goes to IGST across states, or to the taxable value otherwise.
    const gross = round2(amount);
    const interState = isInterState(gstin);
    let taxable = round2(gross / (1 + gstRate / 100));
    const split = splitGst(taxable, gstRate, interState);
    if (!interState) {
      split.cgst = split.sgst = round2((taxable * gstRate) / 200);
      taxable = round2(gross - split.cgst - split.sgst);
    }
    const drift = round2(gross - (taxable + split.cgst + split.sgst + split.igst));
    if (drift !== 0) {
      if (split.igst) split.igst = round2(split.igst + drift);
      else taxable = round2(taxable + drift);
    }
    return { taxable, cgst: split.cgst, sgst: split.sgst, igst: split.igst, interState };
  }, [amount, gstRate, gstin]);

  const dates = useMemo(() => {
    const first = previewFirst({ startDate, frequency, dayOfMonth }, schedule);
    if (!first || !frequency) return { first: null, list: [] as Date[] };
    const day = frequency === "weekly" ? 1 : (dayOfMonth ?? 1);
    const end = endDate ? fromDateInput(endDate) : null;
    return { first, list: upcomingOccurrences(first, frequency, day, 5, end) };
  }, [startDate, frequency, dayOfMonth, endDate, schedule]);
  const pastCount = dates.list.filter((d) => d.getTime() < startOfDayIST().getTime()).length;

  function applyTemplate(t: RecurringTemplate) {
    setTemplateKey(t.key);
    const opts = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
    setValue("name", t.name, opts);
    setValue("category", t.category, opts);
    setValue("frequency", t.frequency, opts);
    setValue("dayOfMonth", t.dayOfMonth, opts);
    setValue("gstRate", t.gstRate, opts);
    if (!getValues("description")) setValue("description", t.description, opts);
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = schedule ? await updateRecurring({ ...values, id: schedule.id }) : await createRecurring(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.value,
        label: p.label,
        description: p.description,
        disabled: p.status === "cancelled",
        icon: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects],
  );
  const employeeOptions = useMemo(
    () => employees.map((e) => ({ value: e.value, label: e.label, description: e.description, disabled: e.status === "exited" && e.value !== schedule?.employee?.id })),
    [employees, schedule?.employee?.id],
  );

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        {!isEdit ? (
          <div className="space-y-2">
            <p className="eyebrow flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Start from a template
            </p>
            <div className="flex flex-wrap gap-2">
              {RECURRING_TEMPLATES.map((t) => (
                <Button
                  key={t.key}
                  type="button"
                  size="sm"
                  variant={templateKey === t.key || (template === t.key && templateKey === null) ? "secondary" : "outline"}
                  onClick={() => applyTemplate(t)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <FormSection title="What" description="Name the schedule and say who is paid." icon={<Tag />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="name" label="Name" required placeholder="Office rent" className="sm:col-span-2" />
            <Field className="gap-1.5">
              <FieldLabel htmlFor="vendor" className="text-[13px]">
                Vendor<span className="text-danger">*</span>
              </FieldLabel>
              <Input id="vendor" list="recurring-vendors" autoComplete="off" placeholder="Who is paid" aria-invalid={Boolean(errors.vendor)} {...form.register("vendor")} />
              <datalist id="recurring-vendors">
                {vendors.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              {errors.vendor ? <FieldError errors={[errors.vendor]} className="text-xs" /> : null}
            </Field>
            <SelectField control={control} name="category" label="Category" required options={CATEGORY_OPTIONS} placeholder="Choose a category" />
            <TextField control={control} name="description" label="Description" placeholder="What is this for?" className="sm:col-span-2" />
          </div>
        </FormSection>

        <FormSection title="Amount" description="The amount paid each time, GST included." icon={<IndianRupee />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="amount" label="Amount per payment" currency required description="Tax included" />
            <Field className="gap-1.5">
              <FieldLabel className="text-[13px]">GST rate</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                value={String(gstRate ?? 0)}
                onValueChange={(v) => v && setValue("gstRate", Number(v), { shouldDirty: true })}
                className="flex-wrap"
                aria-label="GST rate"
              >
                {GST_RATES.map((r) => (
                  <ToggleGroupItem key={r} value={String(r)} className="tabular min-w-12 max-md:h-10">
                    {r}%
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            {gstRate ? (
              <>
                <TextField
                  control={control}
                  name="gstin"
                  label="Supplier GSTIN"
                  placeholder="27AAPFU0939F1ZV"
                  mono
                  transform={(v) => v.toUpperCase().replace(/\s/g, "")}
                />
                <TextField control={control} name="hsnSac" label="HSN / SAC" placeholder="998314" mono />
              </>
            ) : null}
          </div>
          {tax ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="eyebrow text-[10px]">Taxable value</dt>
                <dd className="mt-0.5 font-medium">
                  <Money value={tax.taxable} exact />
                </dd>
              </div>
              {tax.interState ? (
                <div>
                  <dt className="eyebrow text-[10px]">IGST {gstRate}%</dt>
                  <dd className="mt-0.5 font-medium">
                    <Money value={tax.igst} exact />
                  </dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt className="eyebrow text-[10px]">CGST {(gstRate ?? 0) / 2}%</dt>
                    <dd className="mt-0.5 font-medium">
                      <Money value={tax.cgst} exact />
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow text-[10px]">SGST {(gstRate ?? 0) / 2}%</dt>
                    <dd className="mt-0.5 font-medium">
                      <Money value={tax.sgst} exact />
                    </dd>
                  </div>
                </>
              )}
              <div>
                <dt className="eyebrow text-[10px]">Total</dt>
                <dd className="mt-0.5 font-semibold">
                  <Money value={amount} exact />
                </dd>
              </div>
            </dl>
          ) : null}
        </FormSection>

        <FormSection title="Schedule" description="Each due date posts one expense." icon={<CalendarClock />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField control={control} name="frequency" label="How often" required options={RECURRING_FREQUENCIES} />
            {frequency === "weekly" ? (
              <p className="self-end pb-2 text-xs text-muted-foreground">Repeats every 7 days, on the weekday of the start date.</p>
            ) : (
              <Controller
                control={control}
                name="dayOfMonth"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
                    <FieldLabel htmlFor="dayOfMonth" className="text-[13px]">
                      Day of the month<span className="text-danger">*</span>
                    </FieldLabel>
                    <Select value={String(field.value ?? "")} onValueChange={(v) => field.onChange(Number(v))}>
                      <SelectTrigger id="dayOfMonth" ref={field.ref} onBlur={field.onBlur} aria-invalid={fieldState.invalid} className="w-full">
                        <SelectValue placeholder="Pick a day" />
                      </SelectTrigger>
                      <SelectContent>
                        {DAY_OPTIONS.map((d) => (
                          <SelectItem key={d.value} value={String(d.value)}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.error ? <FieldError errors={[fieldState.error]} className="text-xs" /> : null}
                  </Field>
                )}
              />
            )}
            <DateField control={control} name="startDate" label="Start date" required description="The first due date falls on or after this day" />
            <DateField control={control} name="endDate" label="End date" clearable description="Optional. Leave empty to run until ended." />
          </div>

          <div className="space-y-2 rounded-lg border bg-card px-4 py-3">
            <p className="eyebrow">Next 5 dates</p>
            {dates.list.length ? (
              <ol className="flex flex-wrap gap-2">
                {dates.list.map((d, i) => (
                  <li
                    key={d.toISOString()}
                    className={cn(
                      "tabular rounded-md border px-2.5 py-1 text-sm",
                      i === 0 ? "border-brand/50 bg-brand/10 font-medium" : "text-muted-foreground",
                    )}
                  >
                    {formatDate(d)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{startDate && endDate && dates.first ? "No dates fall between the start and end dates." : "Pick a start date to see the dates."}</p>
            )}
            {!isEdit && pastCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {pastCount === 1 ? "1 date is" : `${pastCount} dates are`} already past. They post on the scheduler&apos;s next run.
              </p>
            ) : null}
            {isEdit && schedule && schedule.status !== "ended" ? (
              <p className="text-xs text-muted-foreground">Dates already posted are never posted again.</p>
            ) : null}
          </div>
        </FormSection>

        <FormSection title="Assign" description="Optional. Project spend and salary reports pick these up." icon={<FolderKanban />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <ComboboxField
              control={control}
              name="projectId"
              label="Project"
              options={projectOptions}
              placeholder="Company overhead (no project)"
              searchPlaceholder="Search projects"
              clearable
              onSelected={(v) => !v && setValue("stage", undefined)}
            />
            <SelectField
              control={control}
              name="stage"
              label="Stage"
              required={Boolean(projectId)}
              disabled={!projectId}
              options={PROJECT_STAGES}
              placeholder={projectId ? "Choose a stage" : "Pick a project first"}
            />
            <ComboboxField
              control={control}
              name="employeeId"
              label="Employee"
              options={employeeOptions}
              placeholder="Nobody (not a salary)"
              searchPlaceholder="Search people"
              emptyText="No employees yet."
              clearable
              className="sm:col-span-2"
              description="For salary schedules. Each posted expense is linked to this person."
              onSelected={(v) => {
                const person = employees.find((e) => e.value === v);
                if (person && !getValues("vendor")) setValue("vendor", person.label, { shouldDirty: true });
              }}
            />
          </div>
        </FormSection>

        <FormSection title="Payment and notes" icon={<Wallet />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField control={control} name="paymentMethod" label="Payment method" required options={PAYMENT_OPTIONS} />
          </div>
          <TextareaField control={control} name="notes" label="Notes" placeholder="Anything the accountant should know" rows={3} />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StickyNote className="size-3.5" /> Notes are copied onto every expense this schedule posts.
          </p>
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="max-sm:flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-32 max-sm:flex-1">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Create schedule"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
