import { formatDate } from "@/lib/format";

/** A date for display, or plain words when it is empty (the shared formatter shows a dash). */
export function dateOrNotSet(value: string | Date | null | undefined, fallback = "Not set") {
  return value ? formatDate(value) : fallback;
}
