import "server-only";

import type { Types } from "mongoose";

/** ObjectId | populated doc | null → id string | null */
export function idOf(value: Types.ObjectId | { _id: Types.ObjectId } | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if ("_id" in value && value._id) return String(value._id);
  return String(value);
}

/** Date → ISO string for props crossing to Client Components. */
export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Populated<T> = T & { _id: Types.ObjectId };

/** A populated ref → { id, ...picked fields } or null. */
export function refOf<T extends object, K extends keyof T>(
  value: unknown,
  keys: K[],
): ({ id: string } & Pick<T, K>) | null {
  if (!value || typeof value !== "object" || !("_id" in value)) return null;
  const doc = value as Populated<T>;
  const out = { id: String(doc._id) } as { id: string } & Pick<T, K>;
  for (const key of keys) (out as Record<K, unknown>)[key] = doc[key];
  return out;
}
