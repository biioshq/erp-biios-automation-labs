import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Task } from "@/server/models";
import { listTeamMembers } from "@/server/services/users";
import { startOfDayIST } from "@/lib/dates";
import type { TeamRow } from "./types";

/** Team members with how many open (and overdue) tasks each one has. */
export async function listTeamWithWorkload(): Promise<TeamRow[]> {
  await connectDB();
  const today = startOfDayIST();
  const [members, counts] = await Promise.all([
    listTeamMembers(),
    Task.aggregate<{ _id: Types.ObjectId; open: number; overdue: number }>([
      { $match: { status: { $in: ["pending", "in_progress", "review"] }, assignee: { $ne: null } } },
      {
        $group: {
          _id: "$assignee",
          open: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $and: [{ $gt: ["$dueDate", null] }, { $lt: ["$dueDate", today] }] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const by = new Map(counts.map((c) => [String(c._id), c]));
  return members.map((m) => ({
    ...m,
    openTasks: by.get(m.id)?.open ?? 0,
    overdueTasks: by.get(m.id)?.overdue ?? 0,
  }));
}
