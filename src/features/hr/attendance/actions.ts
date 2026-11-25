"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { can } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { Attendance, Employee } from "@/server/models";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { TIMED_STATUSES, attendanceStatusLabel } from "../constants";
import { clearDaySchema, markDaySchema } from "../schemas";
import { leaveTypeOf } from "../salary/calc";
import { assertMonthsOpen, employedOn, getHrRules, monthOf, todayIST } from "../server";
import { allowedAhead } from "./types";

const REVALIDATE: [string, "layout"][] = [["/hr", "layout"]];

/** Lists names in a sentence: "A", "A and B", "A, B and 3 more". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * Saves rows of the daily sheet. Each entry is one employee's mark for the day; employees left
 * out are not touched. A new mark needs create, a change to a saved mark needs edit.
 */
export const markDay = defineAction(
  markDaySchema,
  async ({ date, entries }, user) => {
    const ids = entries.map((e) => e.employeeId);
    if (new Set(ids).size !== ids.length) throw new AppError("The same person is in the list twice. Reload the page and try again.");

    await assertMonthsOpen([monthOf(date)]);

    const today = todayIST();
    const future = date > today;
    if (future) {
      const bad = entries.filter((e) => !allowedAhead(e.status, e.leaveType));
      if (bad.length) {
        const labels = [...new Set(bad.map((e) => attendanceStatusLabel(e.status).toLowerCase()))].join(" or ");
        throw new AppError(
          `${formatDate(fromDateInput(date))} is still to come, so it cannot be marked ${labels}. Only leave (a full day, or a half day with a leave type), holidays and weekly offs can be marked ahead.`,
        );
      }
    }

    // Every employee must exist and be employed on that day.
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const people = await Employee.find({ _id: { $in: objectIds } }, { name: 1, status: 1, joinDate: 1, exitDate: 1 }).lean();
    const byId = new Map(people.map((p) => [String(p._id), p]));
    if (byId.size !== ids.length) {
      throw new AppError("Some of these employees no longer exist. Reload the page and try again.", "not_found");
    }
    const notEmployed = people.filter((p) => {
      const joinDate = p.joinDate ? toDateInput(p.joinDate) : null;
      const exitDate = p.exitDate ? toDateInput(p.exitDate) : null;
      if (!exitDate && p.status === "exited") return true;
      return !employedOn({ joinDate, exitDate }, date);
    });
    if (notEmployed.length) {
      const names = nameList(notEmployed.map((p) => p.name));
      throw new AppError(`${names} ${notEmployed.length === 1 ? "was" : "were"} not employed on ${formatDate(fromDateInput(date))}, so attendance cannot be marked for that day.`);
    }

    // New marks need create; changes to saved marks need edit.
    const day = fromDateInput(date);
    const existing = await Attendance.find({ employee: { $in: objectIds }, date: day }, { employee: 1, status: 1, leaveType: 1, leaveBatch: 1 }).lean();
    const saved = new Map(existing.map((a) => [String(a.employee), a]));
    const marked = new Set(saved.keys());
    const creating = entries.filter((e) => !marked.has(e.employeeId));
    const changing = entries.filter((e) => marked.has(e.employeeId));
    if (creating.length && !can(user, "hr.attendance:create")) {
      throw new AppError(`Your role cannot mark attendance for people not yet marked (${nameList(creating.map((e) => byId.get(e.employeeId)!.name))}).`, "forbidden");
    }
    if (changing.length && !can(user, "hr.attendance:edit")) {
      throw new AppError(`Your role cannot change attendance that is already marked (${nameList(changing.map((e) => byId.get(e.employeeId)!.name))}).`, "forbidden");
    }

    // Leave types must be in the attendance rules.
    const { rules } = await getHrRules();
    const fieldErrors: Record<string, string[]> = {};
    const badLeave: string[] = [];
    entries.forEach((e, i) => {
      if (e.status === "leave" || (e.status === "half_day" && e.leaveType)) {
        if (!leaveTypeOf(rules, e.leaveType)) {
          badLeave.push(byId.get(e.employeeId)!.name);
          fieldErrors[`entries.${i}.leaveType`] = [e.leaveType ? `${e.leaveType} is not a leave type in the attendance rules` : "Pick the leave type"];
        }
      }
    });
    if (badLeave.length) {
      throw new AppError(`Pick a leave type from the attendance rules for ${nameList(badLeave)}.`, "invalid", fieldErrors);
    }

    const userId = new Types.ObjectId(user.id);
    const ops = entries.map((e) => {
      // Nobody has come in yet on a day still to come, so it has no times.
      const timed = TIMED_STATUSES.includes(e.status) && !future;
      const leaveType = e.status === "leave" || e.status === "half_day" ? (leaveTypeOf(rules, e.leaveType)?.code ?? null) : null;
      const set: Record<string, unknown> = { status: e.status, updatedBy: userId };
      const unset: Record<string, ""> = {};
      if (leaveType) set.leaveType = leaveType;
      else unset.leaveType = "";
      if (timed && e.inTime) set.inTime = e.inTime;
      else unset.inTime = "";
      if (timed && e.inTime && e.outTime) set.outTime = e.outTime;
      else unset.outTime = "";
      if (e.notes) set.notes = e.notes;
      else unset.notes = "";
      // A mark written by a leave record stays part of it only while it is the same leave (same
      // status and leave type); otherwise the leave list would show a day that no longer matches.
      const before = saved.get(e.employeeId);
      const sameLeave = Boolean(leaveType && before?.leaveBatch && before.status === e.status && (before.leaveType ?? null) === leaveType);
      if (!sameLeave) unset.leaveBatch = "";
      return {
        updateOne: {
          filter: { employee: new Types.ObjectId(e.employeeId), date: day },
          update: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { markedBy: userId } },
          upsert: true,
        },
      };
    });
    await Attendance.bulkWrite(ops, { ordered: false });

    return { saved: entries.length, created: creating.length, changed: changing.length };
  },
  { permission: ["hr.attendance:create", "hr.attendance:edit"], revalidate: REVALIDATE, message: "Attendance saved" },
);

/** Clears marks for a day: those people go back to "not marked". */
export const clearDay = defineAction(
  clearDaySchema,
  async ({ date, employeeIds }) => {
    await assertMonthsOpen([monthOf(date)]);
    const result = await Attendance.deleteMany({
      employee: { $in: [...new Set(employeeIds)].map((id) => new Types.ObjectId(id)) },
      date: fromDateInput(date),
    });
    return { cleared: result.deletedCount ?? 0 };
  },
  { permission: "hr.attendance:delete", revalidate: REVALIDATE, message: "Marks cleared" },
);
