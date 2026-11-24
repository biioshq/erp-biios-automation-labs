"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { InventoryAllocation, Scenario } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { can, type SessionUser } from "@/server/auth/session";
import { SCENARIO_STATUSES, labelOf, type ScenarioStatus } from "@/lib/constants";
import { round3 } from "./compute/common";
import { describeInputs, diffInputs } from "./describe";
import {
  ADMIN_ONLY_INPUTS,
  createScenarioSchema,
  demandPrefillSchema,
  parseSpec,
  previewScenarioSchema,
  scenarioIdSchema,
  scenarioStatusChangeSchema,
  updateScenarioSchema,
  type ScenarioFormValues,
  type ScenarioSpec,
} from "./schemas";
import { changedParameters, nameLookup, snapshotFitsViewer, specForViewer } from "./queries";
import { ScenarioDataMissing, runScenario, type Viewer } from "./server/run";
import type { DemandPrefill, ScenarioResults } from "./types";
import { analyticsViewer } from "../viewer";
import { ANALYTICS } from "../links";

/**
 * Scenario actions. They write only to the scenarios collection: a scenario reads stock, budgets,
 * people and money records but never changes them.
 */

const REVALIDATE: [string, "layout"][] = [["/analytics", "layout"]];
const viewerOf = (user: SessionUser): Viewer => analyticsViewer(user);
/** Working figures out before saving is part of creating or editing a scenario. */
const WORK_OUT = [ANALYTICS.scenarios.create, ANALYTICS.scenarios.edit];
const specOf = (form: ScenarioFormValues): ScenarioSpec => ({ type: form.type, inputs: form.inputs }) as ScenarioSpec;
const statusLabel = (s: ScenarioStatus) => labelOf(SCENARIO_STATUSES, s);

async function compute(spec: ScenarioSpec, user: SessionUser): Promise<ScenarioResults> {
  try {
    return await runScenario(specForViewer(spec, viewerOf(user)), viewerOf(user));
  } catch (error) {
    if (error instanceof ScenarioDataMissing) throw new AppError(error.message);
    throw error;
  }
}

/**
 * Inputs as stored. Someone who does not see salaries never sees the salary inputs (salary rates),
 * so their form can only keep what was entered there before (`kept`), never set its own figure.
 */
function storedInputs(form: ScenarioFormValues, user: SessionUser, kept: Record<string, unknown> = {}): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...form.inputs };
  if (viewerOf(user).salaries) return inputs;
  for (const key of ADMIN_ONLY_INPUTS[form.type] ?? []) {
    if (kept[key] !== undefined) inputs[key] = kept[key];
    else delete inputs[key];
  }
  return inputs;
}

const CHANGED_MEANWHILE = "Someone changed this scenario while you were working on it. Reload the page and try again.";

function historyEntry(user: SessionUser, action: string, extra: { changes?: string[]; status?: ScenarioStatus; note?: string } = {}) {
  return { at: new Date(), by: new Types.ObjectId(user.id), byName: user.name, action, changes: extra.changes ?? [], status: extra.status, note: extra.note };
}

/** Works out the results without saving anything, so the form can show them before saving. */
export const previewScenario = defineAction(previewScenarioSchema, async (form, user) => compute(specOf(form), user), { readOnly: true, permission: WORK_OUT });

/**
 * What the chosen projects have used of each material so far (assigned less returned): the demand
 * form's starting requirement. Units wasted on a project count: they were used up on it, so they
 * are part of what the project needed, and its cost keeps them.
 */
export const fetchDemandPrefill = defineAction(
  demandPrefillSchema,
  async (input): Promise<DemandPrefill> => {
    if (!input.projectIds.length || !input.itemIds.length) return {};
    const rows = await InventoryAllocation.aggregate<{ _id: Types.ObjectId; qty: number }>([
      {
        $match: {
          project: { $in: input.projectIds.map((id) => new Types.ObjectId(id)) },
          item: { $in: input.itemIds.map((id) => new Types.ObjectId(id)) },
          quantity: { $gt: 0 },
        },
      },
      { $group: { _id: "$item", qty: { $sum: "$quantity" } } },
    ]);
    return Object.fromEntries(rows.map((r) => [String(r._id), round3(r.qty)]));
  },
  { readOnly: true, permission: WORK_OUT },
);

export const createScenario = defineAction(
  createScenarioSchema,
  async ({ form, status }, user) => {
    const inputs = storedInputs(form, user);
    const spec = { type: form.type, inputs } as ScenarioSpec;
    const results = await compute(spec, user);
    const code = await nextNumber("scenario");
    const created = await Scenario.create({
      code,
      name: form.name,
      type: form.type,
      description: form.description,
      assumptions: form.assumptions,
      status,
      inputs,
      results,
      computedAt: new Date(results.computedAt),
      history: [historyEntry(user, "created", { status, changes: [`Created as ${statusLabel(status).toLowerCase()}`] })],
      createdBy: new Types.ObjectId(user.id),
      updatedBy: new Types.ObjectId(user.id),
    });
    return { id: String(created._id), code };
  },
  { revalidate: REVALIDATE, message: "Scenario saved", permission: ANALYTICS.scenarios.create },
);

export const updateScenario = defineAction(
  updateScenarioSchema,
  async ({ id, form, updatedAt }, user) => {
    const existing = await Scenario.findById(id).lean();
    if (!existing) throw notFound("The scenario");
    if (updatedAt && existing.updatedAt && new Date(existing.updatedAt).toISOString() !== updatedAt) throw new AppError(CHANGED_MEANWHILE, "conflict");
    if (existing.type !== form.type) throw new AppError("A scenario's type cannot change. Duplicate it or start a new one.");
    // Someone who does not see salaries never sees the salary inputs, so their edit keeps what was entered.
    const inputs = storedInputs(form, user, (existing.inputs ?? {}) as Record<string, unknown>);
    const spec = { type: form.type, inputs } as ScenarioSpec;
    const results = await compute(spec, user);

    const before = parseSpec(existing.type, existing.inputs);
    const lookup = await nameLookup(before ? [before, spec] : [spec]);
    // History is read by everyone, so it is written without salary or cash figures: a salary input
    // (a salary rate) is noted as changed without its figures.
    const shared: Viewer = { salaries: false, cash: false };
    const oldInputs = (existing.inputs ?? {}) as Record<string, unknown>;
    const restricted = (ADMIN_ONLY_INPUTS[form.type] ?? []).filter((key) => oldInputs[key] !== inputs[key]);
    const changes = [
      ...(existing.name !== form.name ? [`Name: ${existing.name} to ${form.name}`] : []),
      ...((existing.description ?? undefined) !== form.description ? ["Description changed"] : []),
      ...((existing.assumptions ?? undefined) !== form.assumptions ? ["Assumptions changed"] : []),
      ...diffInputs(before ? describeInputs(specForViewer(before, shared), lookup, shared) : [], describeInputs(specForViewer(spec, shared), lookup, shared)),
      ...(restricted.length ? ["Salary-based cost rate changed (figures not shown)"] : []),
    ];
    // A decision was about the inputs it saw: changing them sends the scenario back to Saved.
    const reopen = existing.status === "approved" || existing.status === "rejected";
    const status: ScenarioStatus = reopen ? "saved" : ((existing.status ?? "draft") as ScenarioStatus);
    if (reopen) changes.push(`Status: ${statusLabel(existing.status as ScenarioStatus)} to Saved, because the scenario was edited after the decision`);

    // Mongoose drops undefined values from $set, so a cleared text field is unset explicitly.
    const unset = [...(form.description ? [] : ["description"]), ...(form.assumptions ? [] : ["assumptions"])];
    // Only if nobody saved or moved it since it was read, so a concurrent approval or edit is never overwritten.
    const res = await Scenario.updateOne(
      { _id: existing._id, updatedAt: existing.updatedAt },
      {
        $set: {
          name: form.name,
          ...(form.description ? { description: form.description } : {}),
          ...(form.assumptions ? { assumptions: form.assumptions } : {}),
          inputs,
          results,
          computedAt: new Date(results.computedAt),
          status,
          updatedBy: new Types.ObjectId(user.id),
        },
        ...(unset.length ? { $unset: Object.fromEntries(unset.map((k) => [k, 1])) } : {}),
        $push: { history: historyEntry(user, "edited", { changes: changes.length ? changes : ["Saved again without changes"], ...(reopen ? { status } : {}) }) },
      },
    );
    if (!res.matchedCount) throw new AppError(CHANGED_MEANWHILE, "conflict");
    return { id };
  },
  { revalidate: REVALIDATE, message: "Scenario updated", permission: ANALYTICS.scenarios.edit },
);

export const duplicateScenario = defineAction(
  scenarioIdSchema,
  async ({ id }, user) => {
    const source = await Scenario.findById(id).lean();
    if (!source) throw notFound("The scenario");
    const spec = parseSpec(source.type, source.inputs);
    // The copy is worked out afresh; when a record it needs is gone it starts without results.
    let results: ScenarioResults | null = null;
    if (spec) {
      try {
        results = await compute(spec, user);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    }
    const code = await nextNumber("scenario");
    const created = await Scenario.create({
      code,
      name: `Copy of ${source.name}`.slice(0, 160),
      type: source.type,
      description: source.description,
      assumptions: source.assumptions,
      status: "draft",
      inputs: source.inputs ?? {},
      results,
      computedAt: results ? new Date(results.computedAt) : undefined,
      duplicatedFrom: source._id,
      history: [historyEntry(user, "duplicated", { status: "draft", changes: [`Copied from ${source.code} (${source.name})`] })],
      createdBy: new Types.ObjectId(user.id),
      updatedBy: new Types.ObjectId(user.id),
    });
    return { id: String(created._id), code };
  },
  { revalidate: REVALIDATE, message: "Scenario duplicated", permission: ANALYTICS.scenarios.create },
);

export const changeScenarioStatus = defineAction(
  scenarioStatusChangeSchema,
  async ({ id, status, note }, user) => {
    const mayDecide = can(user, ANALYTICS.scenarios.approve);
    if ((status === "approved" || status === "rejected") && !mayDecide) {
      throw new AppError("Your role cannot approve or reject a scenario.", "forbidden");
    }
    const existing = await Scenario.findById(id, { status: 1 }).lean();
    if (!existing) throw notFound("The scenario");
    const from = (existing.status ?? "draft") as ScenarioStatus;
    if (from === status) throw new AppError(`The scenario is already ${statusLabel(status).toLowerCase()}.`);
    // A decision stands until someone who may approve changes it. Others can still edit, which reopens it with a recorded reason.
    if ((from === "approved" || from === "rejected") && !mayDecide) {
      throw new AppError(`Your role cannot move a scenario that is ${statusLabel(from).toLowerCase()}. Edit it to send it back to Saved.`, "forbidden");
    }
    // Other moves (draft, saved, archived) are part of editing.
    if (!mayDecide && !can(user, ANALYTICS.scenarios.edit)) throw new AppError("You do not have permission to do this.", "forbidden");
    // Guarded on the status read, so two people changing it at once cannot both win.
    const res = await Scenario.updateOne(
      { _id: existing._id, ...(existing.status === undefined ? { status: { $exists: false } } : { status: existing.status }) },
      {
        $set: { status, updatedBy: new Types.ObjectId(user.id) },
        $push: { history: historyEntry(user, "status", { status, note, changes: [`Status: ${statusLabel(from)} to ${statusLabel(status)}`] }) },
      },
    );
    if (!res.matchedCount) throw new AppError(CHANGED_MEANWHILE, "conflict");
    return { id, status };
  },
  { revalidate: REVALIDATE, message: "Status changed", permission: [ANALYTICS.scenarios.edit, ANALYTICS.scenarios.approve] },
);

/** Replaces the saved results with today's figures, recording what moved. */
export const recalculateScenario = defineAction(
  scenarioIdSchema,
  async ({ id }, user) => {
    const existing = await Scenario.findById(id).lean();
    if (!existing) throw notFound("The scenario");
    const spec = parseSpec(existing.type, existing.inputs);
    if (!spec) throw new AppError("The saved inputs no longer pass the checks. Edit the scenario to fix them.");
    const old = (existing.results ?? null) as ScenarioResults | null;
    // A snapshot with salary or cash figures would lose them in a recalculation by someone who does not see them.
    if (old && !snapshotFitsViewer(old.view, viewerOf(user))) {
      throw new AppError("These results were saved with salary or cash figures your role does not show. Ask someone who can see them to update them.", "forbidden");
    }
    const results = await compute(spec, user);
    const moved = old ? changedParameters(old, results) : [];
    const res = await Scenario.updateOne(
      { _id: existing._id, updatedAt: existing.updatedAt },
      {
        $set: { results, computedAt: new Date(results.computedAt), updatedBy: new Types.ObjectId(user.id) },
        $push: { history: historyEntry(user, "recalculated", { changes: moved.length ? moved.map((m) => `${m} changed with today's data`) : ["No figure changed"] }) },
      },
    );
    if (!res.matchedCount) throw new AppError(CHANGED_MEANWHILE, "conflict");
    return { id };
  },
  { revalidate: REVALIDATE, message: "Saved results updated", permission: ANALYTICS.scenarios.edit },
);

/** Deletes a scenario and its history. Only the scenario itself is removed. */
export const deleteScenario = defineAction(
  scenarioIdSchema,
  async ({ id }) => {
    const res = await Scenario.deleteOne({ _id: new Types.ObjectId(id) });
    if (!res.deletedCount) throw notFound("The scenario");
    return { id };
  },
  { revalidate: REVALIDATE, message: "Scenario deleted", permission: ANALYTICS.scenarios.delete },
);
