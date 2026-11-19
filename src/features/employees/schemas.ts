import { z } from "zod";
import { DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, valuesOf } from "@/lib/constants";
import { dateInput, money, objectId, optionalDateInput, optionalObjectId, optionalText, requiredText } from "@/lib/zod";

/** Validation shared by the employee form (client) and the employee actions (server). Client-safe. */

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, "At most 200 characters")
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.email("Enter a valid email address").optional());

const skillsField = z
  .string()
  .optional()
  .transform((v) =>
    [...new Set((v ?? "").split(",").map((s) => s.trim()).filter(Boolean))],
  )
  .pipe(z.array(z.string().max(40, "Each skill is at most 40 characters")).max(20, "At most 20 skills"));

export const employeeFormSchema = z
  .object({
    name: requiredText("Name", 160),
    email: emailField,
    phone: optionalText(30),
    designation: optionalText(120),
    department: z.enum(valuesOf(DEPARTMENTS), { error: "Pick a department" }),
    employmentType: z.enum(valuesOf(EMPLOYMENT_TYPES), { error: "Pick an employment type" }),
    status: z.enum(valuesOf(EMPLOYEE_STATUSES), { error: "Pick a status" }),
    joinDate: optionalDateInput,
    exitDate: optionalDateInput,
    /** Admins only. Ignored for members. */
    monthlySalary: money.optional(),
    /** Admins only. Keeps the salary schedule (recurring expense) in step with the salary. */
    paySalary: z.boolean().optional(),
    userId: optionalObjectId,
    skills: skillsField,
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.joinDate && v.exitDate && v.exitDate < v.joinDate) {
      ctx.addIssue({ code: "custom", path: ["exitDate"], message: "Exit date is before the join date" });
    }
    if (v.paySalary && !(v.monthlySalary && v.monthlySalary > 0)) {
      ctx.addIssue({ code: "custom", path: ["monthlySalary"], message: "Enter the monthly salary to pay it monthly" });
    }
  });

export type EmployeeFormInput = z.input<typeof employeeFormSchema>;
export type EmployeeFormValues = z.output<typeof employeeFormSchema>;

export const employeeIdSchema = z.object({ id: objectId });

export const EMPLOYEE_FILTER_KEYS = ["department", "status", "employmentType"] as const;

/* Project team */

export const ROLE_SUGGESTIONS = ["Project lead", "Installer", "Electrician", "Firmware", "Hardware", "Design", "Sales"] as const;

const allocation = z
  .number({ error: "Enter a percentage" })
  .int("Use a whole number")
  .min(1, "At least 1%")
  .max(100, "At most 100%");

export const addMemberSchema = z.object({
  projectId: objectId,
  employeeId: objectId,
  role: requiredText("Role", 80),
  allocation,
  startDate: dateInput,
});
export type AddMemberInput = z.input<typeof addMemberSchema>;

export const updateMemberSchema = z.object({
  id: objectId,
  role: requiredText("Role", 80),
  allocation,
});
export type UpdateMemberInput = z.input<typeof updateMemberSchema>;

export const endMemberSchema = z.object({ id: objectId, endDate: optionalDateInput });
