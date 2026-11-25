import "server-only";

import { connectDB } from "@/server/db";
import { Attendance } from "@/server/models";
import { finalisedMonths, getHrRules, holidaysBetween } from "../server";
import type { HrRules } from "../constants";

/** Everything the attendance rules page shows. Read only. */
export type RulesPageData = {
  rules: HrRules;
  /** False while nobody has saved rules yet (the defaults apply). */
  saved: boolean;
  updatedAt: string | null;
  year: number;
  holidays: { id: string; date: string; name: string }[];
  /** Days of attendance that carry each leave code, for codes in use. */
  leaveUsage: Record<string, number>;
  /** Months ("YYYY-MM") of the year whose salary is finalised: their holidays are locked. */
  lockedMonths: string[];
};

/**
 * How many attendance marks carry each leave type code. Counts every status that keeps a code
 * (leave days and half days with a leave half).
 * With `except`, only codes outside that list are counted.
 */
export async function leaveCodeUsage(except?: string[]): Promise<Record<string, number>> {
  await connectDB();
  const rows = await Attendance.aggregate<{ _id: string; days: number }>([
    { $match: { leaveType: except ? { $type: "string", $nin: except } : { $type: "string" } } },
    { $group: { _id: "$leaveType", days: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {};
  for (const r of rows) if (r._id) out[r._id] = r.days;
  return out;
}

export async function getRulesPageData(year: number): Promise<RulesPageData> {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const [{ rules, saved, updatedAt }, holidays, leaveUsage, locked] = await Promise.all([
    getHrRules(),
    holidaysBetween(`${year}-01-01`, `${year}-12-31`),
    leaveCodeUsage(),
    finalisedMonths(months),
  ]);
  return {
    rules,
    saved,
    updatedAt,
    year,
    holidays: holidays.map((h) => ({ id: h.id, date: h.date, name: h.name })),
    leaveUsage,
    lockedMonths: [...locked].sort(),
  };
}
