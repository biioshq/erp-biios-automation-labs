"use server";

import { z } from "zod";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { can } from "@/server/auth/session";
import { objectId } from "@/lib/zod";
import { writeProjectBudget } from "@/features/finance/projects/budget-write";
import { ANALYTICS } from "../links";
import { scenarioBudgetNote, scenarioBudgetTarget } from "./server/project-budget";

/**
 * The one scenario action that changes a real record: it sets a project's budget to what a budget
 * planning scenario proposes, through the same guarded budget write as the project form (budget
 * history entry naming the scenario). The scenario itself is not changed.
 */
export const applyScenarioBudget = defineAction(
  z.object({
    id: objectId,
    /** The project budget shown in the confirm; the change only applies while it is still stored. */
    expectedBudget: z.number().finite(),
  }),
  async ({ id, expectedBudget }, user) => {
    if (!can(user, ANALYTICS.scenarios.view)) throw new AppError("You do not have permission to do this. Ask an admin if you need it.", "forbidden");
    const target = await scenarioBudgetTarget(id);
    if (!target) throw notFound("A whole-project budget scenario");
    const result = await writeProjectBudget(
      { id: target.projectId, budget: target.proposedBudget, expectedBudget, note: scenarioBudgetNote(target) },
      user,
    );
    return { projectId: target.projectId, ...result };
  },
  {
    revalidate: [
      ["/finance", "layout"],
      ["/analytics", "layout"],
    ],
    message: "Project budget updated",
    permission: "finance.projects:edit",
  },
);
