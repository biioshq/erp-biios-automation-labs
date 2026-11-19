import "server-only";

import mongoose, { type ClientSession } from "mongoose";
import { DB_NAME } from "./db-name";

const MONGODB_URI = process.env.MONGODB_URI;

const globalForMongoose = globalThis as unknown as {
  __mongoose?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
  __mongoTransactions?: Promise<boolean>;
};

const cached = (globalForMongoose.__mongoose ??= { conn: null, promise: null });

/** Connects once per server process (and survives hot reloads in dev). */
export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;
  if (!MONGODB_URI) throw new Error("MONGODB_URI is not set. Copy .env.example to .env.local.");
  cached.promise ??= mongoose
    .connect(MONGODB_URI, {
      dbName: DB_NAME,
      bufferCommands: false,
      maxPoolSize: process.env.VERCEL ? 10 : 20,
      serverSelectionTimeoutMS: 8000,
      // In production indexes are built once at boot by ensureDatabase() (src/server/setup-db.ts).
      autoIndex: process.env.NODE_ENV !== "production",
      appName: "biios-project-manager",
    })
    .catch((error) => {
      cached.promise = null;
      throw error;
    });
  cached.conn = await cached.promise;
  return cached.conn;
}

/** True when the server is a replica set or sharded cluster (Atlas), so multi-document transactions work. */
async function supportsTransactions(): Promise<boolean> {
  globalForMongoose.__mongoTransactions ??= (async () => {
    const conn = await connectDB();
    const hello = await conn.connection.db!.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  })().catch(() => false);
  return globalForMongoose.__mongoTransactions;
}

export type UnitOfWork = {
  /** Pass to every query: `{ session }`. Undefined on a standalone server. */
  session: ClientSession | undefined;
  /** Registers a compensating step, run in reverse order if the work fails without a transaction. */
  onRollback: (undo: () => Promise<unknown>) => void;
};

/**
 * Runs multi-document work atomically: inside a transaction when the server
 * supports one, otherwise with compensating steps registered via `onRollback`.
 * Ledger code writes guarded, conditional updates first (e.g. `available >= qty`),
 * so a concurrent request can never drive stock negative either way.
 */
export async function runAtomic<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  await connectDB();
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await work({ session, onRollback: () => {} });
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  const undo: (() => Promise<unknown>)[] = [];
  try {
    return await work({ session: undefined, onRollback: (step) => undo.push(step) });
  } catch (error) {
    for (const step of undo.reverse()) {
      await step().catch((rollbackError) => console.error("[runAtomic] rollback step failed", rollbackError));
    }
    throw error;
  }
}
