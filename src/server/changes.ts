import "server-only";

import { connectDB } from "@/server/db";

/**
 * A company-wide change counter that open pages poll (/api/live) to refresh themselves when
 * someone else changes data. Bumped after every successful change; one tiny document in
 * `counters`, so a check costs a single indexed read.
 */
const KEY = "live:changes";

type Counter = { _id: string; seq: number; at?: Date };

export async function bumpChanges(): Promise<void> {
  try {
    const conn = await connectDB();
    await conn.connection
      .db!.collection<Counter>("counters")
      .updateOne({ _id: KEY }, { $inc: { seq: 1 }, $set: { at: new Date() } }, { upsert: true });
  } catch (error) {
    // Live refresh is a convenience: never fail the change that triggered it.
    console.error("[live] could not record a change", error);
  }
}

export async function changeVersion(): Promise<number> {
  const conn = await connectDB();
  const doc = await conn.connection.db!.collection<Counter>("counters").findOne({ _id: KEY }, { projection: { seq: 1 } });
  return doc?.seq ?? 0;
}
