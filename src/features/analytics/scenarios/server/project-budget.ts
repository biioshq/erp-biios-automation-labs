import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Project, Scenario } from "@/server/models";
import { round2 } from "@/lib/format";
import { parseSpec } from "../schemas";

/**
 * "Use as project budget" on a budget planning scenario. Only a scenario for a whole project fits:
 * a stage or budget-head scenario plans part of the project, so its figure is not the project
 * budget. Rejected scenarios are not offered. The proposed budget is read from the stored inputs
 * the same way the scenario works it out (computeBudget), never taken from the browser.
 */
export type ScenarioBudgetTarget = {
  scenarioId: string;
  code: string;
  name: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  /** The project's budget today: what the change replaces. */
  currentBudget: number;
  /** The budget the scenario started from (may differ from today's when it was revised since). */
  scenarioBaseBudget: number;
  proposedBudget: number;
};

export async function scenarioBudgetTarget(id: string): Promise<ScenarioBudgetTarget | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const doc = await Scenario.findById(id, { code: 1, name: 1, type: 1, status: 1, inputs: 1 }).lean();
  if (!doc || doc.type !== "budget" || doc.status === "rejected") return null;
  const spec = parseSpec(doc.type, doc.inputs);
  if (!spec || spec.type !== "budget") return null;
  const inputs = spec.inputs;
  if (inputs.scope !== "project" || !inputs.projectId || inputs.stage || inputs.head) return null;
  const project = await Project.findById(inputs.projectId, { name: 1, code: 1, budget: 1 }).lean();
  if (!project) return null;
  const base = round2(inputs.currentBudget);
  const proposed = round2(inputs.mode === "amount" ? (inputs.proposedBudget ?? base) : base + (inputs.change ?? 0));
  if (proposed < 0) return null;
  return {
    scenarioId: String(doc._id),
    code: doc.code,
    name: doc.name,
    projectId: String(project._id),
    projectName: project.name,
    projectCode: project.code,
    currentBudget: project.budget ?? 0,
    scenarioBaseBudget: base,
    proposedBudget: proposed,
  };
}

/** The note kept with the old budget in the project's budget history. */
export const scenarioBudgetNote = (t: Pick<ScenarioBudgetTarget, "code" | "name">) => `From budget scenario ${t.code} ${t.name}`.slice(0, 500);
