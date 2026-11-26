import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AUDIT_SOURCES, auditValues } from "@/lib/audit";

/**
 * The audit trail (collection auditLogs): one entry per change to a money record, written after the
 * change succeeded (src/server/audit.ts). Entries are only ever added; the one later write is
 * setting `salary` on a record's earlier entries once that record becomes salary data. They never
 * touch the record they describe, so a record's updatedAt and its guards are unaffected.
 *
 * `entity.id` is a string because some entities are not documents with an ObjectId (an expense
 * category is identified by its value). `salary` marks entries about salary expenses or salary
 * rules: people without the salaries permission never see them. `changes` holds small display
 * values only (text cut short, ids as strings, days as yyyy-mm-dd).
 */
const entitySchema = new Schema(
  {
    type: { type: String, enum: auditValues(AUDIT_ENTITY_TYPES), required: true },
    id: { type: String, required: true, maxlength: 100 },
    label: { type: String, maxlength: 240 },
  },
  { _id: false },
);

const actorSchema = new Schema(
  {
    id: { type: Schema.Types.ObjectId, ref: "User" },
    /** Kept with the entry, so it still reads right after the person is renamed or removed. */
    name: { type: String, required: true, maxlength: 160 },
  },
  { _id: false },
);

const changeSchema = new Schema(
  {
    field: { type: String, required: true, maxlength: 60 },
    from: { type: Schema.Types.Mixed },
    to: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const refSchema = new Schema(
  {
    statement: { type: Schema.Types.ObjectId, ref: "BankStatement" },
    line: { type: Schema.Types.ObjectId, ref: "BankTransaction" },
    payment: { type: Schema.Types.ObjectId },
    draft: { type: Schema.Types.ObjectId, ref: "ExpenseDraft" },
    schedule: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice" },
    income: { type: Schema.Types.ObjectId, ref: "Income" },
  },
  { _id: false },
);

const auditLogSchema = new Schema(
  {
    at: { type: Date, required: true },
    actor: { type: actorSchema, required: true },
    action: { type: String, enum: auditValues(AUDIT_ACTIONS), required: true },
    entity: { type: entitySchema, required: true },
    changes: { type: [changeSchema], default: undefined },
    source: { type: String, enum: auditValues(AUDIT_SOURCES), required: true },
    ref: { type: refSchema },
    note: { type: String, maxlength: 400 },
    salary: { type: Boolean },
  },
  { versionKey: false },
);
auditLogSchema.index({ "entity.type": 1, "entity.id": 1, at: -1 });
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ "actor.id": 1, at: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };
export const AuditLog: Model<AuditLogDoc> = models.AuditLog ?? model<AuditLogDoc>("AuditLog", auditLogSchema, "auditLogs");
