"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, isDuplicateKeyError, notFound } from "@/server/errors";
import { HrHoliday, HrSettings } from "@/server/models";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { holidayIdSchema, holidaySchema, hrRulesSchema } from "../schemas";
import { assertMonthsOpen, ensureHrIndexes, monthOf } from "../server";
import { leaveCodeUsage } from "./queries";

const REVALIDATE: [string, "layout"][] = [["/hr", "layout"]];

const dayCount = (n: number) => `${formatNumber(n)} ${n === 1 ? "day" : "days"}`;

/**
 * Saves the attendance rules. A leave type whose code is on any attendance mark cannot be removed
 * (or have its code changed), or those days would lose their meaning: the save stops and says why.
 * Finalised months keep the rules they were finalised with, so no month lock applies here.
 */
export const saveHrRules = defineAction(
  hrRulesSchema,
  async (rules, user) => {
    // The upsert below relies on the unique key index for a single rules document.
    await ensureHrIndexes();
    const orphaned = Object.entries(await leaveCodeUsage(rules.leaveTypes.map((t) => t.code))).sort(([a], [b]) => a.localeCompare(b));
    if (orphaned.length) {
      const list = orphaned.map(([code, days]) => `${code} is used on ${dayCount(days)} of attendance`).join("; ");
      throw new AppError(
        orphaned.length === 1
          ? `${list}. Keep that leave type in the list, or add it back if it was removed: you can change the name, but not the code.`
          : `${list}. Keep those leave types in the list, or add them back if they were removed: you can change the names, but not the codes.`,
        "conflict",
        { leaveTypes: [`Still in use: ${orphaned.map(([code]) => code).join(", ")}`] },
      );
    }
    await HrSettings.findOneAndUpdate(
      { key: "default" },
      { $set: { rules, updatedBy: new Types.ObjectId(user.id) }, $setOnInsert: { key: "default" } },
      { upsert: true },
    );
    return { saved: true };
  },
  { permission: "hr.settings:edit", revalidate: REVALIDATE, message: "Attendance rules saved" },
);

/** Adds a company holiday. One holiday per day. */
export const addHoliday = defineAction(
  holidaySchema,
  async ({ date, name }, user) => {
    // The holidays page shows 2000 to 2100 only; a holiday outside that could never be seen or deleted.
    const year = Number(date.slice(0, 4));
    if (year < 2000 || year > 2100) {
      throw new AppError("Pick a date from 2000 to 2100.", "invalid", { date: ["Pick a date from 2000 to 2100"] });
    }
    await assertMonthsOpen([monthOf(date)]);
    const day = fromDateInput(date);
    const taken = () =>
      new AppError(`${formatDate(day)} is already a holiday. Delete it first if you want to change it.`, "conflict", {
        date: ["Already a holiday"],
      });
    const existing = await HrHoliday.findOne({ date: day }, { name: 1 }).lean();
    if (existing) {
      throw new AppError(`${formatDate(day)} is already a holiday (${existing.name}). Delete it first if you want to change it.`, "conflict", {
        date: ["Already a holiday"],
      });
    }
    try {
      const created = await HrHoliday.create({ date: day, name, createdBy: new Types.ObjectId(user.id) });
      return { id: String(created._id), date };
    } catch (error) {
      if (isDuplicateKeyError(error)) throw taken();
      throw error;
    }
  },
  { permission: "hr.settings:edit", revalidate: REVALIDATE, message: "Holiday added" },
);

/** Deletes a holiday. The day becomes a working day again (or a weekly off, by the rules). */
export const deleteHoliday = defineAction(
  holidayIdSchema,
  async ({ id }) => {
    const holiday = await HrHoliday.findById(id, { date: 1 }).lean();
    if (!holiday) throw notFound("The holiday");
    await assertMonthsOpen([monthOf(toDateInput(holiday.date))]);
    await HrHoliday.deleteOne({ _id: holiday._id });
    return { id };
  },
  { permission: "hr.settings:edit", revalidate: REVALIDATE, message: "Holiday deleted" },
);
