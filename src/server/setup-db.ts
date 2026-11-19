import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/server/db";
import { DB_NAME, LEGACY_DB_NAMES } from "@/server/db-name";
import * as models from "@/server/models";

/**
 * Creates every collection and index the app needs. Idempotent: safe on every
 * boot and from `npm run db:setup`. Never drops indexes, so Better Auth's own
 * indexes on user/session/account are left alone.
 */
export async function ensureDatabase(): Promise<{ collections: number; indexes: number }> {
  await adoptLegacyDatabase();
  const list = (Object.values(models) as unknown[]).filter(
    (m): m is mongoose.Model<unknown> => typeof m === "function" && "createIndexes" in m && m !== models.User,
  );
  let indexes = 0;
  for (const model of list) {
    await model.createCollection().catch(() => undefined);
    await model.createIndexes();
    indexes += model.schema.indexes().length;
  }
  // Better Auth looks these up on every request; create them up front too.
  const db = mongoose.connection.db!;
  const authIndexes: [string, Record<string, 1>, { unique?: boolean }][] = [
    ["user", { email: 1 }, { unique: true }],
    ["session", { token: 1 }, { unique: true }],
    ["session", { userId: 1 }, {}],
    ["account", { userId: 1 }, {}],
  ];
  for (const [collection, keys, options] of authIndexes) {
    await db
      .collection(collection)
      .createIndex(keys, options)
      .catch(() => undefined); // already exists under Better Auth's own name
  }
  await runMigrations(db);
  return { collections: list.length, indexes };
}

/** Collections that only this app's database has, used to recognise an old copy of it. */
const ERP_SIGNATURE = ["user", "account", "expenses", "projects", "inventory", "tasks"];

/** The database the connection string itself names (where data went before DB_NAME existed). */
function uriDatabase(): string {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(process.env.MONGODB_URI ?? "");
  return decodeURIComponent(match?.[1] ?? "") || "test";
}

/**
 * The database used to be named by the connection string (biios_erp, biios_pm, ...). When the
 * new database has no users yet and exactly one old database holds this app's data, copy every
 * collection across once. The old database is never changed or dropped.
 * MONGODB_COPY_FROM names the source explicitly when more than one qualifies.
 */
export async function adoptLegacyDatabase(): Promise<void> {
  const conn = await connectDB();
  const target = conn.connection.db!;
  if ((await target.collection("user").countDocuments({}, { limit: 1 })) > 0) return;

  const names = process.env.MONGODB_COPY_FROM ? [process.env.MONGODB_COPY_FROM] : [uriDatabase(), ...LEGACY_DB_NAMES];
  const sources: string[] = [];
  for (const name of [...new Set(names)].filter((n) => n !== DB_NAME)) {
    try {
      const db = conn.connection.getClient().db(name);
      const present = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
      if (ERP_SIGNATURE.every((c) => present.has(c)) && (await db.collection("user").countDocuments({}, { limit: 1 })) > 0) {
        sources.push(name);
      }
    } catch (error) {
      console.warn(`[setup] could not read database "${name}" to look for older data:`, error instanceof Error ? error.message : error);
    }
  }
  if (sources.length === 0) return;
  if (sources.length > 1) {
    console.warn(`[setup] found Project Manager data in ${sources.map((s) => `"${s}"`).join(" and ")}; not copying. Set MONGODB_COPY_FROM to the one to use.`);
    return;
  }

  const sourceName = sources[0]!;
  const source = conn.connection.getClient().db(sourceName);
  // Markers written while this database was empty refer to no users; the source brings its own.
  await target.collection("counters").deleteMany({ _id: { $regex: /^migration:/ } } as never);
  const collections = (await source.listCollections({ type: "collection" }, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."))
    // Users last: if the copy stops halfway, the next start sees no users and finishes it.
    .sort((a, b) => Number(a === "user") - Number(b === "user"));

  let copied = 0;
  for (const name of collections) {
    const cursor = source.collection(name).find({}, { batchSize: 500 });
    let batch: Record<string, unknown>[] = [];
    const flush = async () => {
      if (!batch.length) return;
      try {
        await target.collection(name).insertMany(batch as never[], { ordered: false });
      } catch (error) {
        // Documents already copied by an earlier, interrupted run are fine; anything else is not.
        const writeErrors = (error as { writeErrors?: { code: number }[] }).writeErrors;
        if (!writeErrors?.length || writeErrors.some((e) => e.code !== 11000)) throw error;
      }
      copied += batch.length;
      batch = [];
    };
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= 500) await flush();
    }
    await flush();
    const [from, to] = await Promise.all([source.collection(name).countDocuments(), target.collection(name).countDocuments()]);
    if (to < from) throw new Error(`[setup] copying "${name}" from "${sourceName}" stopped short (${to} of ${from}); restart to finish.`);
  }
  await target
    .collection<{ _id: string; seq: number; from: string; at: Date }>("counters")
    .updateOne({ _id: `migration:copied-from:${sourceName}` }, { $set: { seq: 1, from: sourceName, at: new Date() } }, { upsert: true });
  console.log(`[setup] copied ${copied} documents in ${collections.length} collections from "${sourceName}" to "${DB_NAME}". "${sourceName}" is unchanged; drop it once you have checked the data.`);
}

/** One-time data migrations, each recorded in `counters` so it runs once per database. */
async function runMigrations(db: NonNullable<typeof mongoose.connection.db>) {
  const done = async (id: string) =>
    (await db.collection<{ _id: string }>("counters").findOne({ _id: `migration:${id}` })) !== null;
  const mark = (id: string) =>
    db.collection<{ _id: string; seq: number }>("counters").updateOne({ _id: `migration:${id}` }, { $set: { seq: 1 } }, { upsert: true });

  // Google account linking needs the local email marked verified. Until now every account was
  // created by an admin or as the first admin while sign-up was closed, so their emails are trusted.
  // Skipped when sign-up is open, since anyone could have registered any address.
  const verified = "2026-11-verify-admin-created-emails";
  if (process.env.ALLOW_OPEN_SIGNUP !== "true" && !(await done(verified))) {
    const result = await db.collection("user").updateMany({ emailVerified: { $ne: true } }, { $set: { emailVerified: true } });
    await mark(verified);
    if (result.modifiedCount) console.log(`[setup] marked ${result.modifiedCount} admin-created account email(s) as verified`);
  }

  // Older writes added quantities as plain doubles and left drift such as 5.55e-17 or
  // 0.19999999999999998 in the stock balances. The ledger now keeps 3 decimals; round what is
  // stored the same way (the `+ 0` turns -0 into 0) so the Mongo status filters, the low-stock
  // list and the ledger forms agree. quantity is rebuilt from its rounded parts so it stays
  // available + allocated. Plain driver updates: updatedAt is left alone.
  const quantities = "2026-11-round-stock-quantities";
  if (!(await done(quantities))) {
    // A missing field (quantityReturned on early assignments) becomes its schema default, 0, not null.
    const r3 = (value: unknown) => ({ $add: [{ $round: [{ $ifNull: [value, 0] }, 3] }, 0] });
    const items = await db
      .collection(models.InventoryItem.collection.collectionName)
      .updateMany({}, [{ $set: { available: r3("$available"), allocated: r3("$allocated") } }, { $set: { quantity: r3({ $add: ["$available", "$allocated"] }) } }]);
    const allocations = await db
      .collection(models.InventoryAllocation.collection.collectionName)
      .updateMany({}, [{ $set: { quantity: r3("$quantity"), quantityAssigned: r3("$quantityAssigned"), quantityReturned: r3("$quantityReturned") } }]);
    await mark(quantities);
    const changed = items.modifiedCount + allocations.modifiedCount;
    if (changed) console.log(`[setup] rounded stock quantities to 3 decimals on ${items.modifiedCount} item(s) and ${allocations.modifiedCount} assignment(s)`);
  }
}
