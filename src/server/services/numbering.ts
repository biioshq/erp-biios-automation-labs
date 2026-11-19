import "server-only";

import type { ClientSession } from "mongoose";
import { Counter } from "@/server/models";
import { financialYearIST } from "@/lib/dates";

type Sequence = "expense" | "income" | "project" | "task" | "employee" | "recurring";

const FORMATS: Record<Sequence, { prefix: string; pad: number; yearly: boolean }> = {
  expense: { prefix: "EXP", pad: 5, yearly: true },
  income: { prefix: "INC", pad: 5, yearly: true },
  project: { prefix: "PRJ", pad: 4, yearly: false },
  task: { prefix: "TSK", pad: 4, yearly: false },
  employee: { prefix: "EMP", pad: 4, yearly: false },
  recurring: { prefix: "RCR", pad: 4, yearly: false },
};

/**
 * Next human-readable number: EXP-2627-00042 (financial year 2026-27), PRJ-0007.
 * Atomic per sequence, so concurrent creates never collide.
 */
export async function nextNumber(sequence: Sequence, session?: ClientSession, date: Date = new Date()): Promise<string> {
  const format = FORMATS[sequence];
  const fy = financialYearIST(date).label.replace(/^FY (\d{2})(\d{2})-(\d{2})$/, "$2$3");
  const key = format.yearly ? `${sequence}:${fy}` : sequence;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session },
  ).lean();
  const seq = String(counter!.seq).padStart(format.pad, "0");
  return format.yearly ? `${format.prefix}-${fy}-${seq}` : `${format.prefix}-${seq}`;
}
