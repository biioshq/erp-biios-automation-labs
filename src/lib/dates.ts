/**
 * Calendar-day helpers on IST boundaries. Client-safe.
 *
 * MongoDB stores UTC instants. Business dates (expense date, due date) are
 * calendar days in India, so a date input "2026-11-19" is stored as
 * 2026-11-19T00:00:00+05:30, and "today", "overdue" and date-range filters are
 * computed against IST midnight, never the server's local zone.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-19" → the instant of IST midnight on that day. */
export function fromDateInput(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

/** An instant → "2026-11-19" (its IST calendar day), for <input type="date"> and pickers. */
export function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST midnight at the start of the day containing `date`. */
export function startOfDayIST(date: Date = new Date()): Date {
  return fromDateInput(toDateInput(date));
}

/** The last millisecond of the IST day containing `date`. */
export function endOfDayIST(date: Date = new Date()): Date {
  return new Date(startOfDayIST(date).getTime() + DAY_MS - 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** IST midnight on the first day of the month containing `date`, shifted by `offset` months. */
export function startOfMonthIST(date: Date = new Date(), offset = 0): Date {
  const [y, m] = toDateInput(date).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + offset, 1));
  return fromDateInput(target.toISOString().slice(0, 10));
}

/** "2026-11" month key in IST, for grouping. */
export function monthKeyIST(date: Date | string): string {
  return toDateInput(date).slice(0, 7);
}

/** The Indian financial year (April–March) containing `date`, as IST instants. */
export function financialYearIST(date: Date = new Date()): { start: Date; end: Date; label: string } {
  const [y, m] = toDateInput(date).split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return {
    start: fromDateInput(`${startYear}-04-01`),
    end: new Date(fromDateInput(`${startYear + 1}-04-01`).getTime() - 1),
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
  };
}

/** Is a due date before today (IST)? */
export function isOverdue(due: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false;
  return new Date(due).getTime() < startOfDayIST(now).getTime();
}

/** Mongo-ready range filter from optional "yyyy-mm-dd" bounds, inclusive of both days. */
export function dateRangeFilter(from?: string | null, to?: string | null): { $gte?: Date; $lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) range.$gte = fromDateInput(from);
  if (to) range.$lte = new Date(fromDateInput(to).getTime() + DAY_MS - 1);
  return range;
}
