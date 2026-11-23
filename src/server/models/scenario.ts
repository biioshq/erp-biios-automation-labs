import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { SCENARIO_STATUSES, SCENARIO_TYPES, valuesOf } from "@/lib/constants";

const historySchema = new Schema(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true, maxlength: 160 },
    /** created, edited, status, duplicated, recalculated */
    action: { type: String, required: true, maxlength: 40 },
    /** Human-readable list of what changed ("Demand change: 10% to 20%"). */
    changes: { type: [String], default: [] },
    status: { type: String, enum: valuesOf(SCENARIO_STATUSES) },
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

/**
 * A what-if scenario. Its inputs are hypothetical and live only here: computing or saving a
 * scenario never changes stock, budgets, purchases, people or money records. `results` is the
 * outcome as computed when last saved, so comparisons and history stay stable.
 */
const scenarioSchema = new Schema(
  {
    /** SCN-0004 */
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    type: { type: String, enum: valuesOf(SCENARIO_TYPES), required: true, index: true },
    description: { type: String, trim: true, maxlength: 4000 },
    assumptions: { type: String, trim: true, maxlength: 4000 },
    status: { type: String, enum: valuesOf(SCENARIO_STATUSES), default: "draft", index: true },
    inputs: { type: Schema.Types.Mixed, default: {} },
    /** Current position and scenario figures as computed at the last save. */
    results: { type: Schema.Types.Mixed, default: null },
    computedAt: { type: Date },
    duplicatedFrom: { type: Schema.Types.ObjectId, ref: "Scenario" },
    history: { type: [historySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, minimize: false },
);
scenarioSchema.index({ name: "text", description: "text", code: "text" });

export type ScenarioDoc = InferSchemaType<typeof scenarioSchema> & { _id: Types.ObjectId };
export const Scenario: Model<ScenarioDoc> = models.Scenario ?? model<ScenarioDoc>("Scenario", scenarioSchema, "scenarios");

/**
 * A forecast as it stood on a day, kept so it can later be compared with what happened
 * (Analytics > Forecast vs actual). Written at most once per kind, key and month.
 */
const forecastSnapshotSchema = new Schema(
  {
    kind: { type: String, enum: ["material_demand", "project_cost"], required: true },
    /** Item id or project id. */
    key: { type: String, required: true },
    label: { type: String, trim: true, maxlength: 200 },
    /** "2026-11": the month the forecast was made in. */
    month: { type: String, required: true },
    /** The period the forecast covers. */
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    predicted: { type: Number, required: true },
    unit: { type: String, trim: true, maxlength: 20 },
    basis: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);
forecastSnapshotSchema.index({ kind: 1, key: 1, month: 1 }, { unique: true });

export type ForecastSnapshotDoc = InferSchemaType<typeof forecastSnapshotSchema> & { _id: Types.ObjectId };
export const ForecastSnapshot: Model<ForecastSnapshotDoc> =
  models.ForecastSnapshot ?? model<ForecastSnapshotDoc>("ForecastSnapshot", forecastSnapshotSchema, "forecastSnapshots");
