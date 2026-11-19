import { startOfDayIST } from "@/lib/dates";

/**
 * A project membership is current until its end date has come. A future end date (a person on notice, or an
 * end planned ahead) keeps them on the team until that day, the same way their salary keeps posting until it.
 * An end date of today or earlier is past, so "end today" takes them off the team at once.
 */
export function currentMembership(now: Date = new Date()) {
  return { $or: [{ endDate: null }, { endDate: { $gt: startOfDayIST(now) } }] };
}

/** The same test for a membership already loaded. */
export function isCurrentMembership(endDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  return !endDate || new Date(endDate).getTime() > startOfDayIST(now).getTime();
}
