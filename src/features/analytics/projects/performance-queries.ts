import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { ProjectMember, Task, User } from "@/server/models";
import type { TaskPriority, TaskStatus } from "@/lib/constants";
import { fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { budgetExhaustionDay } from "./model";
import type { ProjectCostRow } from "./queries";

/**
 * Project performance (5.5), from the Tasks module and project spend:
 *  - Progress: completed tasks out of the project's tasks, cancelled ones left out.
 *  - Overdue: due before today (IST) and neither completed nor cancelled, as the Tasks module counts it.
 *  - Expected completion by tasks: the latest due date of the open tasks.
 *  - Budget used up at the current rate: start + days elapsed x budget / spent, only where the
 *    shared project forecast has a spend rate (src/features/analytics/project-forecast.ts).
 *  - Cost performance: progress divided by the share of the budget spent (above 1: more work done
 *    than money spent, in proportion).
 *  - Actual completion: the project records no completion date; for completed projects the last
 *    task completion is shown as exactly that.
 */

export type TaskProgress = { total: number; completed: number; cancelled: number; open: number; overdue: number; undated: number; progress: number | null };

export type PerformanceRow = {
  project: ProjectCostRow;
  tasks: TaskProgress;
  latestOpenDue: string | null;
  lastCompleted: string | null;
  budgetUsedUp: string | null;
  costPerformance: number | null;
  people: number;
  fte: number;
};

export type OverdueTask = {
  id: string;
  number: string;
  title: string;
  projectId: string;
  projectName: string;
  color: string;
  assignee: string | null;
  dueDate: string;
  daysLate: number;
  priority: TaskPriority;
  status: TaskStatus;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getPerformance(rows: ProjectCostRow[], now: Date = new Date()): Promise<{ rows: PerformanceRow[]; overdue: OverdueTask[]; noProjectTasks: number }> {
  await connectDB();
  const ids = rows.map((r) => new Types.ObjectId(r.id));
  const today = startOfDayIST(now);
  const [tasks, members, noProjectTasks] = await Promise.all([
    Task.find({ project: { $in: ids } }, { number: 1, title: 1, project: 1, assignee: 1, dueDate: 1, status: 1, priority: 1, completedAt: 1 }).lean(),
    ProjectMember.find({ project: { $in: ids }, endDate: null }, { project: 1, allocation: 1 }).lean(),
    Task.countDocuments({ project: null, status: { $nin: ["completed", "cancelled"] } }),
  ]);
  const userIds = [...new Set(tasks.filter((t) => t.assignee).map((t) => String(t.assignee)))].map((id) => new Types.ObjectId(id));
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }, { name: 1 }).lean() : [];
  const userName = new Map(users.map((u) => [String(u._id), u.name ?? "Someone"]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out = new Map<string, PerformanceRow>(
    rows.map((r) => [
      r.id,
      {
        project: r,
        tasks: { total: 0, completed: 0, cancelled: 0, open: 0, overdue: 0, undated: 0, progress: null },
        latestOpenDue: null,
        lastCompleted: null,
        // Only where the shared forecast rule has a spend rate (30 days since the start, a planned end
        // not passed, some spend): paused, closed, late and too-new projects get no date.
        budgetUsedUp: r.prediction.basis === "rate" ? budgetExhaustionDay(r, toDateInput(now)) : null,
        costPerformance: null,
        people: 0,
        fte: 0,
      },
    ]),
  );
  const overdue: OverdueTask[] = [];
  for (const t of tasks) {
    const row = out.get(String(t.project));
    if (!row) continue;
    const status = t.status as TaskStatus;
    if (status === "cancelled") {
      row.tasks.cancelled += 1;
      continue;
    }
    row.tasks.total += 1;
    if (status === "completed") {
      row.tasks.completed += 1;
      const done = t.completedAt ? toDateInput(t.completedAt) : null;
      if (done && (!row.lastCompleted || done > row.lastCompleted)) row.lastCompleted = done;
      continue;
    }
    row.tasks.open += 1;
    if (!t.dueDate) {
      row.tasks.undated += 1;
      continue;
    }
    const due = toDateInput(t.dueDate);
    if (!row.latestOpenDue || due > row.latestOpenDue) row.latestOpenDue = due;
    if (t.dueDate.getTime() < today.getTime()) {
      row.tasks.overdue += 1;
      const p = byId.get(String(t.project))!;
      overdue.push({
        id: String(t._id),
        number: t.number,
        title: t.title,
        projectId: p.id,
        projectName: p.name,
        color: p.color,
        assignee: t.assignee ? (userName.get(String(t.assignee)) ?? null) : null,
        dueDate: due,
        daysLate: Math.round((today.getTime() - fromDateInput(due).getTime()) / DAY_MS),
        priority: (t.priority ?? "medium") as TaskPriority,
        status,
      });
    }
  }
  for (const m of members) {
    const row = out.get(String(m.project));
    if (!row) continue;
    row.people += 1;
    row.fte = Math.round((row.fte + (m.allocation ?? 0) / 100) * 100) / 100;
  }
  for (const row of out.values()) {
    const t = row.tasks;
    t.progress = t.total > 0 ? t.completed / t.total : null;
    const u = row.project.utilisation;
    row.costPerformance = t.progress !== null && u !== null && u > 0 ? t.progress / u : null;
  }
  return { rows: [...out.values()], overdue: overdue.sort((a, b) => b.daysLate - a.daysLate), noProjectTasks };
}
