import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/server/db";
import * as models from "@/server/models";

/**
 * Creates every collection and index the app needs. Idempotent: safe on every
 * boot and from `npm run db:setup`. Never drops indexes, so Better Auth's own
 * indexes on user/session/account are left alone.
 */
export async function ensureDatabase(): Promise<{ collections: number; indexes: number }> {
  await connectDB();
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
}
