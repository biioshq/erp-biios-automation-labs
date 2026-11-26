import "server-only";

import { Types, type UpdateQuery } from "mongoose";
import { Project, type ProjectDoc } from "@/server/models";
import { AppError, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/session";
import { round2 } from "@/lib/format";

/**
 * The one way a project's budget is written: the project form (updateProject), the Edit budget
 * dialog (setProjectBudget) and "Use as project budget" on a budget scenario all go through here.
 *  - The write only applies while the stored budget is still the one the person saw
 *    (expectedBudget), so an older screen cannot put back a figure someone else replaced.
 *  - When the budget changes, the budget it had is pushed onto budgetHistory (older entries are
 *    never rewritten), so the original budget stays known.
 */

/** The budgetHistory entry for a change away from `previousBudget`. */
export function budgetHistoryEntry(previousBudget: number, note: string | undefined, user: SessionUser) {
  return { budget: previousBudget, changedAt: new Date(), changedBy: new Types.ObjectId(user.id), ...(note ? { note } : {}) };
}

/** Applies `update` only while the project's budget is still `expected`; a clear error otherwise. */
export async function guardedProjectUpdate(id: string, expected: number, update: UpdateQuery<ProjectDoc>) {
  const result = await Project.updateOne({ _id: id, budget: expected }, update);
  if (!result.matchedCount) {
    const exists = await Project.exists({ _id: id });
    if (!exists) throw notFound("The project");
    throw new AppError("Someone changed this project's budget while you were editing. Close the form, open it again and save once more.", "conflict");
  }
}

/**
 * Sets only the budget of a project (nothing else on it changes), with the guard and the history
 * entry. Returns whether it changed: setting the budget it already has writes nothing.
 */
export async function writeProjectBudget(
  input: { id: string; budget: number; expectedBudget: number; note?: string },
  user: SessionUser,
): Promise<{ changed: boolean; previous: number; budget: number }> {
  const budget = round2(input.budget);
  const previous = input.expectedBudget;
  if (round2(previous) === budget) {
    // Nothing to change, but the person should still learn when the budget moved meanwhile.
    const current = await Project.findById(input.id, { budget: 1 }).lean();
    if (!current) throw notFound("The project");
    if (current.budget !== previous) {
      throw new AppError("Someone changed this project's budget while you were editing. Close the form, open it again and save once more.", "conflict");
    }
    return { changed: false, previous, budget };
  }
  await guardedProjectUpdate(input.id, previous, { $set: { budget }, $push: { budgetHistory: budgetHistoryEntry(previous, input.note, user) } });
  return { changed: true, previous, budget };
}
