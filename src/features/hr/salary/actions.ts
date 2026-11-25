"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { can, type SessionUser } from "@/server/auth/session";
import { AppError, isDuplicateKeyError } from "@/server/errors";
import { PayrollAdjustment, PayrollRun } from "@/server/models";
import { adjustmentSchema, monthSchema } from "../schemas";
import { assertMonthsOpen, employeesBetween, monthOf, monthRange, todayIST } from "../server";
import { computeSalaryLines, salaryTotals } from "./queries";
import { monthLabel } from "./types";

/**
 * Salary from attendance: bonuses and deductions, and finalising or reopening a month. Every
 * action needs "hr.salary:approve" and "data.salaries". None of them touches Expenses: salary
 * expenses are still posted by each person's salary schedule in Recurring expenses.
 */

const REVALIDATE: [string, "layout"][] = [["/hr", "layout"]];

function assertSeesSalaries(user: SessionUser) {
  if (!can(user, "data.salaries")) {
    throw new AppError("Salary amounts are not part of your role, so you cannot change them. Ask an admin if you need this.", "forbidden");
  }
}

function assertNotFuture(month: string) {
  if (month > monthOf(todayIST())) throw new AppError(`${monthLabel(month)} has not started yet.`, "invalid");
}

/** Saves a bonus, deductions and a note for one person and month; clears them when all are empty. */
export const saveAdjustment = defineAction(
  adjustmentSchema,
  async (input, user) => {
    assertSeesSalaries(user);
    assertNotFuture(input.month);
    await assertMonthsOpen([input.month]);
    const { from, to } = monthRange(input.month);
    const employed = await employeesBetween(from, to, { withSalary: false });
    if (!employed.some((e) => e.id === input.employeeId)) {
      throw new AppError(`This person was not employed in ${monthLabel(input.month)}, or was deleted.`, "not_found");
    }
    const employee = new Types.ObjectId(input.employeeId);
    const note = input.note?.trim() || "";
    if (!input.additions && !input.deductions && !note) {
      await PayrollAdjustment.deleteOne({ employee, month: input.month });
      return { cleared: true };
    }
    const set = { additions: input.additions, deductions: input.deductions, updatedBy: new Types.ObjectId(user.id), ...(note ? { note } : {}) };
    await PayrollAdjustment.findOneAndUpdate(
      { employee, month: input.month },
      note ? { $set: set } : { $set: set, $unset: { note: 1 } },
      { upsert: true, runValidators: true },
    );
    return { cleared: false };
  },
  { permission: "hr.salary:approve", revalidate: REVALIDATE, message: "Adjustment saved" },
);

/** Stores the month's salary lines as they are now and locks its attendance, leave and adjustments. */
export const finaliseMonth = defineAction(
  monthSchema,
  async ({ month }, user) => {
    assertSeesSalaries(user);
    assertNotFuture(month);
    const alreadyFinalised = () => new AppError(`${monthLabel(month)} is already finalised.`, "conflict");
    const existing = await PayrollRun.findOne({ month }, { status: 1 }).lean();
    if (existing?.status === "finalised") throw alreadyFinalised();
    const { lines, rules } = await computeSalaryLines(month, { withSalary: true });
    if (!lines.length) throw new AppError(`Nobody was employed in ${monthLabel(month)}, so there is nothing to finalise.`, "invalid");
    // Matches only a month that is not finalised: when someone finalised it meanwhile, the insert
    // hits the unique month index and this stops instead of replacing their lines.
    await PayrollRun.findOneAndUpdate(
      { month, status: { $ne: "finalised" } },
      {
        $set: {
          status: "finalised",
          lines,
          rules,
          totals: salaryTotals(lines),
          finalisedBy: new Types.ObjectId(user.id),
          finalisedAt: new Date(),
        },
      },
      { upsert: true, runValidators: true },
    ).catch((error: unknown) => {
      throw isDuplicateKeyError(error) ? alreadyFinalised() : error;
    });
    return { month };
  },
  { permission: "hr.salary:approve", revalidate: REVALIDATE, message: "Month finalised" },
);

/** Unlocks a finalised month: its salary is worked out live again until it is finalised again. */
export const reopenMonth = defineAction(
  monthSchema,
  async ({ month }, user) => {
    assertSeesSalaries(user);
    const updated = await PayrollRun.findOneAndUpdate(
      { month, status: "finalised" },
      { $set: { status: "reopened", reopenedBy: new Types.ObjectId(user.id), reopenedAt: new Date() } },
      { runValidators: true },
    ).lean();
    if (!updated) throw new AppError(`${monthLabel(month)} is not finalised.`, "conflict");
    return { month };
  },
  { permission: "hr.salary:approve", revalidate: REVALIDATE, message: "Month reopened" },
);
