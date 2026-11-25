"use client";

/**
 * A page-wide "there are unsaved edits" flag for HR sheets. The daily sheet sets it while it has
 * changes; PeriodNav asks before moving to another day or month, which would drop them.
 */
let unsaved = 0;

export function setUnsavedChanges(count: number) {
  unsaved = count;
}

/** True when it is fine to leave: nothing unsaved, or the person confirmed. */
export function confirmLeave(): boolean {
  if (!unsaved) return true;
  return window.confirm(`You have ${unsaved} unsaved ${unsaved === 1 ? "change" : "changes"} on this day. Leave without saving them?`);
}
