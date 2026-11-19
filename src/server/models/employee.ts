import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { DEPARTMENTS, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, valuesOf } from "@/lib/constants";

/**
 * A person on the payroll or on contract. Independent of sign-in accounts:
 * `user` links an employee to their login when they have one.
 * Salaries are paid through a recurring expense linked back here.
 */
const employeeSchema = new Schema(
  {
    /** EMP-0007 */
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 30 },
    designation: { type: String, trim: true, maxlength: 120 },
    department: { type: String, enum: valuesOf(DEPARTMENTS), default: "engineering", index: true },
    employmentType: { type: String, enum: valuesOf(EMPLOYMENT_TYPES), default: "full_time" },
    status: { type: String, enum: valuesOf(EMPLOYEE_STATUSES), default: "active", index: true },
    joinDate: { type: Date },
    exitDate: { type: Date },
    /** Monthly cost to company, in rupees. Visible to admins only. */
    monthlySalary: { type: Number, min: 0, default: 0 },
    /** The recurring expense that pays this salary, when set up. */
    salaryRecurring: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
    user: { type: Schema.Types.ObjectId, ref: "User" },
    skills: [{ type: String, trim: true, maxlength: 40 }],
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
employeeSchema.index({ name: "text", designation: "text", email: "text", code: "text" });
employeeSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

export type EmployeeDoc = InferSchemaType<typeof employeeSchema> & { _id: Types.ObjectId };
export const Employee: Model<EmployeeDoc> = models.Employee ?? model<EmployeeDoc>("Employee", employeeSchema, "employees");
