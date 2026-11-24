"use client";

import { useEffect, useTransition } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Briefcase, KeyRound, StickyNote, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { useCan } from "@/components/current-user";
import { applyFieldErrors } from "@/lib/action-result";
import { DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { createEmployee, updateEmployee } from "../actions";
import { employeeFormSchema, type EmployeeFormInput, type EmployeeFormValues } from "../schemas";
import type { EmployeeDetail, UserLinkOption } from "../types";
import { formValidation } from "@/components/forms/form-options";

function defaultsFrom(employee?: EmployeeDetail | null): EmployeeFormInput {
  return {
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    designation: employee?.designation ?? "",
    department: employee?.department ?? (undefined as unknown as EmployeeFormInput["department"]),
    employmentType: employee?.employmentType ?? "full_time",
    status: employee?.status ?? "active",
    joinDate: employee?.joinDate ? toDateInput(employee.joinDate) : employee ? undefined : toDateInput(new Date()),
    exitDate: employee?.exitDate ? toDateInput(employee.exitDate) : undefined,
    monthlySalary: employee?.monthlySalary || undefined,
    paySalary: employee?.paysSalary ?? false,
    userId: employee?.userId ?? undefined,
    skills: (employee?.skills ?? []).join(", "),
    notes: employee?.notes ?? "",
  };
}

/** Create or edit an employee. Salary controls render only with the salaries data permission; the server ignores them otherwise. */
export function EmployeeForm({
  employee,
  users,
  onDone,
  onCancel,
}: {
  employee?: EmployeeDetail | null;
  users: UserLinkOption[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(employee);
  const seesSalaries = useCan("data.salaries");
  const [pending, startTransition] = useTransition();
  const form = useForm<EmployeeFormInput, unknown, EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: defaultsFrom(employee),
    ...formValidation,
  });
  // The skills text is transformed to a list on output, so the field components get the input-typed control.
  const control = form.control as unknown as Control<EmployeeFormInput>;
  const { setValue, getValues } = form;
  const status = useWatch({ control, name: "status" });
  const exited = status === "exited";

  // Leaving: suggest today as the exit date, and stop paying salary.
  useEffect(() => {
    if (!exited) return;
    if (!getValues("exitDate")) setValue("exitDate", toDateInput(new Date()));
    setValue("paySalary", false);
  }, [exited, getValues, setValue]);

  const accountOptions = users.map((u) => ({
    value: u.value,
    label: u.label,
    description: u.description,
    disabled: Boolean(u.linkedEmployeeId && u.linkedEmployeeId !== employee?.id),
  }));

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const input: EmployeeFormInput = { ...values, skills: values.skills.join(", ") };
      const result = employee ? await updateEmployee({ ...input, id: employee.id }) : await createEmployee(input);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? (isEdit ? "Employee updated" : "Employee added"));
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody>
        <div className="space-y-5">
          <FormSection title="Person" icon={<User />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={control} name="name" label="Full name" required className="sm:col-span-2" autoFocus={!isEdit} />
              <TextField control={control} name="email" label="Email" type="email" placeholder="name@company.com" />
              <TextField control={control} name="phone" label="Phone" type="tel" placeholder="+91 98xxx xxxxx" />
              <TextField control={control} name="designation" label="Designation" placeholder="Field engineer" className="sm:col-span-2" />
              <TextField
                control={control}
                name="skills"
                label="Skills"
                placeholder="Wiring, PLC, Firmware"
                description="Separate with commas."
                className="sm:col-span-2"
              />
            </div>
          </FormSection>

          <FormSection title="Work" icon={<Briefcase />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={control} name="department" label="Department" required options={DEPARTMENTS} placeholder="Pick a department" />
              <SelectField control={control} name="employmentType" label="Employment type" required options={EMPLOYMENT_TYPES} />
              <SelectField control={control} name="status" label="Status" required options={EMPLOYEE_STATUSES} />
              <DateField control={control} name="joinDate" label="Join date" clearable />
              {exited ? (
                <DateField control={control} name="exitDate" label="Exit date" description="Open project memberships end on this date." />
              ) : null}
            </div>
          </FormSection>

          {seesSalaries ? (
            <FormSection title="Salary" icon={<Wallet />} description="Only people who may see individual salaries can see and change this.">
              <div className="grid gap-4">
                <NumberField control={control} name="monthlySalary" label="Monthly salary" currency placeholder="0" description="Cost to company per month." />
                <Controller
                  control={control}
                  name="paySalary"
                  render={({ field }) => (
                    <label className="flex min-h-10 items-start justify-between gap-4 rounded-lg border bg-card px-3.5 py-3">
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-sm font-medium">Pay salary monthly</span>
                        <span className="block text-xs text-pretty text-muted-foreground">
                          {exited
                            ? "Salary stops when someone is marked as exited."
                            : "Adds a monthly schedule to Recurring expenses. It posts the salary on the last day of each month."}
                        </span>
                      </span>
                      <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} disabled={exited} className="mt-0.5" />
                    </label>
                  )}
                />
              </div>
            </FormSection>
          ) : null}

          <FormSection title="Sign-in account" icon={<KeyRound />} description="Optional. Links this person to their login so their tasks show here.">
            <ComboboxField
              control={control}
              name="userId"
              label="Account"
              options={accountOptions}
              placeholder="No account linked"
              searchPlaceholder="Search team members…"
              clearable
            />
          </FormSection>

          <FormSection title="Notes" icon={<StickyNote />}>
            <TextareaField control={control} name="notes" placeholder="Anything the team should know" rows={3} />
          </FormSection>
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="h-10 sm:h-9">
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="h-10 min-w-32 sm:h-9">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Add employee"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
