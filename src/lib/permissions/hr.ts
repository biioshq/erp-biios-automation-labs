import type { PermissionResource } from "./types";

/**
 * HR: attendance, leaves, salary worked out from attendance, and the attendance rules. Client-safe.
 * New in this module, so the built-in Member role gets none of it: an admin gives it through a role.
 */
export const HR_RESOURCES: PermissionResource[] = [
  {
    key: "hr.attendance",
    module: "hr",
    group: "Attendance",
    label: "Attendance",
    description:
      "Daily attendance and the monthly register: in and out times, present, absent and half days. Create marks a day that is not marked yet, edit changes a marked day, delete clears a mark.",
    actions: ["view", "create", "edit", "delete", "export"],
    memberDefault: [],
  },
  {
    key: "hr.leaves",
    module: "hr",
    group: "Attendance",
    label: "Leaves",
    description: "Leave records and leave balances. Create records leave for a day or a range of days, delete removes it.",
    actions: ["view", "create", "delete"],
    memberDefault: [],
  },
  {
    key: "hr.salary",
    module: "hr",
    group: "Attendance",
    label: "Salary from attendance",
    description:
      "Each person's salary for a month, worked out from their attendance. Amounts also need Individual salaries. Approve adds bonuses and deductions, and finalises or reopens a month.",
    actions: ["view", "export", "approve"],
    memberDefault: [],
  },
  {
    key: "hr.settings",
    module: "hr",
    group: "Attendance",
    label: "Attendance rules and holidays",
    description: "Office hours, weekly offs, late and half-day rules, leave types, holidays and how salary is worked out.",
    actions: ["view", "edit"],
    memberDefault: [],
  },
];
