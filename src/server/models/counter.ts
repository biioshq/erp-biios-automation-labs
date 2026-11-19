import { Schema, model, models, type Model } from "mongoose";

/** Sequences for human-readable document numbers (EXP-2026-00042). */
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { versionKey: false });

export const Counter: Model<{ _id: string; seq: number }> = models.Counter ?? model("Counter", counterSchema, "counters");
