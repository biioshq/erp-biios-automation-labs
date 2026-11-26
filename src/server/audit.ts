import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { Types } from "mongoose";
import { AuditLog } from "@/server/models";
import { toDateInput } from "@/lib/dates";
import type { AuditAction, AuditEntityType, AuditSource } from "@/lib/audit";

/**
 * Writes the audit trail (collection auditLogs). Best effort: a failed write is logged to the
 * console and never fails the change it describes. It writes only to auditLogs, so the record's
 * own fields and its updatedAt (which several writes use as a guard) never change because of it.
 *
 * Who did it and where the change came from are taken from the context: defineAction runs every
 * action inside `withAuditContext({ actor })`, and the imports wrap the saves they make through the
 * expense and income forms in `withAuditContext({ source: "csv_import" })` (or "drive"), so those
 * records read "Imported" instead of "Created" by hand.
 */

type Actor = { id?: string | null; name: string };
type AuditRef = Partial<Record<"statement" | "line" | "payment" | "draft" | "schedule" | "invoice" | "income", string | Types.ObjectId | null | undefined>>;
type Context = { actor?: Actor; source?: AuditSource; ref?: AuditRef };

const storage = new AsyncLocalStorage<Context>();

/** Runs `fn` with this actor, source or reference added to the audit context (inner values win). */
export function withAuditContext<T>(ctx: Context, fn: () => T): T {
  const outer = storage.getStore() ?? {};
  return storage.run({ ...outer, ...ctx, ref: { ...outer.ref, ...ctx.ref } }, fn);
}

export const SYSTEM_ACTOR: Actor = { name: "System" };

export type AuditValue = string | number | boolean | null;
export type AuditChange = { field: string; from: AuditValue; to: AuditValue };

export type AuditEntry = {
  action: AuditAction;
  entity: { type: AuditEntityType; id: string | Types.ObjectId; label?: string | null };
  changes?: AuditChange[];
  /** Defaults to the context's source, else "manual". */
  source?: AuditSource;
  ref?: AuditRef;
  /** About a salary expense or salary rule: hidden from people without the salaries permission. */
  salary?: boolean;
  note?: string | null;
  /** Defaults to the context's actor, else "System". */
  actor?: Actor;
};

const MAX_TEXT = 200;
const MAX_CHANGES = 40;

const cut = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A value small enough for the trail: text cut short, ids as strings, dates as their IST day. */
export function auditValue(v: unknown): AuditValue {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return cut(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toDateInput(v);
  if (v instanceof Types.ObjectId) return String(v);
  if (typeof v === "object" && "_id" in (v as object)) return String((v as { _id: unknown })._id);
  return cut(String(v));
}

const same = (a: AuditValue, b: AuditValue) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : a === b);

/** The fields whose value differs between two snapshots, in the order of `fields`. */
export function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>, fields?: string[]): AuditChange[] {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const out: AuditChange[] = [];
  for (const field of keys) {
    const from = auditValue(before[field]);
    const to = auditValue(after[field]);
    if (!same(from, to)) out.push({ field, from, to });
  }
  return out;
}

/** A snapshot as the "to" side of a new record (or the "from" side of a deleted one). */
export function snapshotChanges(snapshot: Record<string, unknown>, side: "to" | "from"): AuditChange[] {
  return Object.entries(snapshot).flatMap(([field, v]) => {
    const value = auditValue(v);
    if (value === null || value === false) return [];
    return [side === "to" ? { field, from: null, to: value } : { field, from: value, to: null }];
  });
}

const oidOrUndefined = (v: string | Types.ObjectId | null | undefined) =>
  v instanceof Types.ObjectId ? v : typeof v === "string" && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : undefined;

function refOf(ref: AuditRef | undefined) {
  if (!ref) return undefined;
  const out: Record<string, Types.ObjectId> = {};
  for (const [k, v] of Object.entries(ref)) {
    const id = oidOrUndefined(v);
    if (id) out[k] = id;
  }
  return Object.keys(out).length ? out : undefined;
}

function toDoc(e: AuditEntry, ctx: Context, at: Date) {
  const actor = e.actor ?? ctx.actor ?? SYSTEM_ACTOR;
  const source = e.source ?? ctx.source ?? "manual";
  // A record made by an import is "Imported", whichever form it went through.
  const action: AuditAction = e.action === "created" && source !== "manual" && source !== "recurring" && source !== "system" ? "imported" : e.action;
  const changes = (e.changes ?? []).slice(0, MAX_CHANGES).map((c) => ({ field: cut(c.field, 60), from: auditValue(c.from), to: auditValue(c.to) }));
  const actorId = oidOrUndefined(actor.id ?? undefined);
  return {
    at,
    actor: { ...(actorId ? { id: actorId } : {}), name: cut(actor.name || "Unknown", 160) },
    action,
    entity: { type: e.entity.type, id: String(e.entity.id), ...(e.entity.label ? { label: cut(e.entity.label, 240) } : {}) },
    ...(changes.length ? { changes } : {}),
    source,
    ...(refOf({ ...ctx.ref, ...e.ref }) ? { ref: refOf({ ...ctx.ref, ...e.ref }) } : {}),
    ...(e.note ? { note: cut(e.note, 400) } : {}),
    ...(e.salary ? { salary: true } : {}),
  };
}

/**
 * Adds entries to the audit trail. Never throws: a failure is logged and the caller carries on.
 * Await it (an unawaited write may be cut off when a serverless function returns).
 */
export async function audit(entries: AuditEntry | AuditEntry[] | null | undefined): Promise<void> {
  const list = (Array.isArray(entries) ? entries : entries ? [entries] : []).filter(Boolean);
  if (!list.length) return;
  try {
    const ctx = storage.getStore() ?? {};
    const at = new Date();
    const docs = list.map((e) => toDoc(e, ctx, at));
    if (docs.length === 1) await AuditLog.create(docs[0]);
    else await AuditLog.insertMany(docs, { ordered: false });
  } catch (error) {
    console.error("[audit] could not write the audit trail", error);
  }
}

/**
 * Runs `build` (which may read the database to describe the change) and writes what it returns.
 * Anything that goes wrong, in building or in writing, is logged and never reaches the caller.
 */
export async function auditSafely(build: () => Promise<AuditEntry | AuditEntry[] | null | undefined> | AuditEntry | AuditEntry[] | null | undefined): Promise<void> {
  try {
    await audit(await build());
  } catch (error) {
    console.error("[audit] could not describe a change for the audit trail", error);
  }
}
