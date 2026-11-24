"use client";

import { useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ComboboxField, DateField, NumberField, SelectField, TextField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { DEPARTMENTS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";
import { manpowerFormSchema } from "../../schemas";
import { ScenarioFormShell } from "./form-shell";
import { inDays, metaDefaults, projectOptions, type TypeFormProps } from "./options";

type In = z.input<typeof manpowerFormSchema>;
type Out = z.output<typeof manpowerFormSchema>;

const SCOPES = [
  { value: "project", label: "A project" },
  { value: "department", label: "A department" },
];

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  return {
    ...metaDefaults(initial),
    type: "manpower",
    inputs: {
      scope: saved?.scope ?? "project",
      projectId: saved?.projectId ?? "",
      department: saved?.department,
      role: saved?.role ?? "",
      skill: saved?.skill ?? "",
      requiredCount: saved?.requiredCount ?? (undefined as unknown as number),
      periodFrom: saved?.periodFrom ?? inDays(7),
      periodTo: saved?.periodTo ?? inDays(97),
      monthlyCost: saved?.monthlyCost,
      overtimeHours: saved?.overtimeHours,
      overtimeRate: saved?.overtimeRate,
    },
  };
}

/** 1.6 HR and manpower. Members never see or send salary figures. */
export function ManpowerForm({ options, initial, seesSalaries }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(manpowerFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control, setValue } = form;
  const scope = useWatch({ control, name: "inputs.scope" });
  const department = useWatch({ control, name: "inputs.department" });
  const projects = useMemo(() => projectOptions(options.projects), [options.projects]);
  const departments = useMemo(
    () => DEPARTMENTS.map((d) => ({ value: d.value, label: `${d.label} (${options.departments.find((x) => x.value === d.value)?.active ?? 0} active)` })),
    [options.departments],
  );
  const average = options.departments.find((d) => d.value === department)?.averageSalary ?? null;

  // People who see salaries: picking a department fills the monthly cost with its average salary, once per change.
  const lastDept = useRef(String(initial?.inputs.department ?? ""));
  useEffect(() => {
    if (!seesSalaries || !department || department === lastDept.current) return;
    lastDept.current = department;
    if (average !== null) setValue("inputs.monthlyCost", average, { shouldDirty: true });
  }, [seesSalaries, department, average, setValue]);

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="People needed" description="Checked against the team records: active people and their project allocations.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField control={control} name="inputs.scope" label="For" options={SCOPES} />
          {scope === "project" ? (
            <ComboboxField control={control} name="inputs.projectId" label="Project" options={projects} placeholder="Pick a project" />
          ) : (
            <SelectField control={control} name="inputs.department" label="Department" options={departments} />
          )}
          {scope === "project" ? <SelectField control={control} name="inputs.department" label="Department (for costing)" options={departments} clearable placeholder="Optional" /> : null}
          <TextField control={control} name="inputs.role" label="Role" placeholder="Installer" />
          <TextField
            control={control}
            name="inputs.skill"
            label="Skill"
            placeholder="Optional"
            description={options.skills.length ? `Skills on record: ${options.skills.slice(0, 8).join(", ")}${options.skills.length > 8 ? "…" : ""}` : "No skills are recorded on employees yet; designations are matched instead."}
          />
          <NumberField control={control} name="inputs.requiredCount" label="People required" step={1} />
          <div className="grid grid-cols-2 gap-3">
            <DateField control={control} name="inputs.periodFrom" label="From" required />
            <DateField control={control} name="inputs.periodTo" label="To" required />
          </div>
        </div>
      </Section>
      <Section title="Cost" description={seesSalaries ? "Salary figures are shown only to people who can see salaries." : "Salary-based costs are left out for your role. Overtime you enter is costed for everyone."}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {seesSalaries ? (
            <NumberField
              control={control}
              name="inputs.monthlyCost"
              label="Monthly cost a person"
              currency
              description={average !== null ? `Department average ${formatCurrency(average)}` : "Empty uses the department's average salary"}
            />
          ) : null}
          <NumberField control={control} name="inputs.overtimeHours" label="Overtime hours a month (team)" step="any" />
          <NumberField control={control} name="inputs.overtimeRate" label="Overtime rate an hour" currency />
        </div>
      </Section>
    </ScenarioFormShell>
  );
}
