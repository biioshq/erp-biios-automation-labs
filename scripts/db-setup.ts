/**
 * Prepares a MongoDB database for the app: checks the connection, then creates
 * every collection and index (idempotent; never drops anything).
 *
 *   npm run db:setup
 *
 * The server also does this at every start, so this is for preparing a new
 * database (Atlas or self-hosted) ahead of the first deploy, or checking one.
 */
import mongoose from "mongoose";
import { validateEnv } from "@/server/env";
import { ensureDatabase } from "@/server/setup-db";

async function main() {
  validateEnv();
  const started = Date.now();
  const result = await ensureDatabase();
  const db = mongoose.connection.db!;
  const hello = await db.admin().command({ hello: 1 });
  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log(`Connected to ${db.databaseName} (${hello.setName ? `replica set ${hello.setName}, transactions on` : "standalone, transactions off"}).`);
  console.log(`Ready: ${result.collections} app collections, ${result.indexes} indexes, in ${Date.now() - started} ms.`);
  console.log(`Collections: ${collections.join(", ")}`);
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
