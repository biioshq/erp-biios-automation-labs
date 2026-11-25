"use server";

import { randomUUID } from "node:crypto";
import { Types, type QueryFilter } from "mongoose";
import { defineAction } from "@/server/action";
import { can } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { Attendance, type AttendanceDoc } from "@/server/models";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { attendanceStatusLabel } from "../constants";
import { leaveFormSchema } from "../schemas";
import { assertMonthsOpen, monthOf } from "../server";
import { monthsBetween, planLeave } from "./plan";
import { deleteLeaveSchema, leavePreviewSchema } from "./schemas";
import type { LeavePlan } from "./types";

const REVALIDATE: [string, "layout"][] = [["/hr", "layout"]];

const dayLabel = (date: string) => formatDate(fromDateInput(date));

/** Works out what a leave would record, without saving anything. Used by the record leave dialog. */
export const previewLeave = defineAction(
  leavePreviewSchema,
  async (input): Promise<LeavePlan> => planLeave(input),
  { permission: "hr.leaves:create", readOnly: true },
);

/**
 * Records leave for one person over one day or a range of days: one attendance mark per day,
 * all sharing a new leave batch id so the leave lists and deletes as one.
 */
export const recordLeave = defineAction(
  leaveFormSchema,
  async (input, user) => {
    await assertMonthsOpen(monthsBetween(input.from, input.to));
    const plan = await planLeave(input);

    if (!plan.days.length) {
      if (plan.skippedNotEmployed && !plan.skippedOff.length) {
        throw new AppError(`${plan.employee.name} was not employed on any of those days, so no leave was recorded.`, "invalid", {
          from: ["Outside the person's employment"],
        });
      }
      throw new AppError(
        "Every day in that range is a weekly off, a holiday or outside the person's employment, so there is nothing to record. To record leave on weekly offs and holidays, turn off \"Leave out weekly offs and holidays\".",
        "invalid",
      );
    }

    if (plan.conflicts.length && !input.overwrite) {
      const shown = plan.conflicts.slice(0, 8).map((c) => `${dayLabel(c.date)} (${attendanceStatusLabel(c.status).toLowerCase()})`);
      const more = plan.conflicts.length - shown.length;
      throw new AppError(
        `${plan.conflicts.length === 1 ? "This day is" : "These days are"} already marked: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}. Replace those marks, or change the dates.`,
        "conflict",
        { overwrite: ["Replace those marks to record the leave"] },
      );
    }
    // Replacing a present, absent or half day mark changes attendance that is already marked,
    // which the daily sheet allows only with attendance edit. Plain leave marks are replaced freely.
    if (plan.conflicts.length && !can(user, "hr.attendance:edit")) {
      throw new AppError(
        "Some of these days are already marked on the daily sheet, and your role cannot change marked attendance. Ask someone who can edit attendance, or change the dates.",
        "forbidden",
      );
    }

    const employee = new Types.ObjectId(plan.employee.id);
    const userId = new Types.ObjectId(user.id);
    const leaveBatch = randomUUID();
    const status = input.halfDay ? "half_day" : "leave";

    const ops = plan.days.map((date) => {
      const set: Record<string, unknown> = { status, leaveType: plan.type.code, leaveBatch, updatedBy: userId };
      const unset: Record<string, ""> = {};
      if (input.reason) set.notes = input.reason;
      else unset.notes = "";
      // A full day of leave has no in and out times. A half day keeps the times of the half worked.
      if (!input.halfDay) {
        unset.inTime = "";
        unset.outTime = "";
      }
      return {
        updateOne: {
          filter: { employee, date: fromDateInput(date) },
          update: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { markedBy: userId } },
          upsert: true,
        },
      };
    });
    await Attendance.bulkWrite(ops, { ordered: false });

    return {
      employeeName: plan.employee.name,
      typeName: plan.type.name,
      recorded: plan.days.length,
      units: plan.units,
      skippedOff: plan.skippedOff.length,
      skippedNotEmployed: plan.skippedNotEmployed,
      replaced: input.overwrite ? plan.conflicts.length : 0,
    };
  },
  { permission: "hr.leaves:create", revalidate: REVALIDATE, message: "Leave recorded" },
);

/** Only leave marks are removed by deleteLeave: a leave day, or a half day that carries a leave type. */
const leaveMarks = (ids: Types.ObjectId[]): QueryFilter<AttendanceDoc> => ({
  _id: { $in: ids },
  $or: [{ status: "leave" }, { status: "half_day", leaveType: { $type: "string", $ne: "" } }],
});

/** Deletes one leave run: its days go back to "not marked". Marks that are no longer leave are left alone. */
export const deleteLeave = defineAction(
  deleteLeaveSchema,
  async ({ ids }) => {
    const objectIds = [...new Set(ids)].map((id) => new Types.ObjectId(id));
    const marks = await Attendance.find(leaveMarks(objectIds), { employee: 1, date: 1 }).lean();
    if (!marks.length) throw new AppError("This leave was already removed, or its days were marked as something else.", "not_found");

    const people = new Set(marks.map((m) => String(m.employee)));
    if (people.size > 1) throw new AppError("Those days belong to more than one person. Delete one person's leave at a time.", "invalid");

    await assertMonthsOpen([...new Set(marks.map((m) => monthOf(toDateInput(m.date))))]);
    const result = await Attendance.deleteMany(leaveMarks(marks.map((m) => m._id)));
    return { deleted: result.deletedCount ?? 0 };
  },
  { permission: "hr.leaves:delete", revalidate: REVALIDATE, message: "Leave deleted" },
);
