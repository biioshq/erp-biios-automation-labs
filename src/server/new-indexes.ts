import "server-only";

import {
  AccountTransfer,
  BankAccount,
  BankPartyRule,
  BankStatement,
  BankTransaction,
  CapitalEntry,
  EquityHolder,
  FinanceGroup,
  FixedAsset,
  ForecastSnapshot,
  Investment,
  Invoice,
  Liability,
  Role,
  Scenario,
} from "@/server/models";
import { AppError } from "@/server/errors";

/** What this file needs from a model: its name and a way to build its schema's indexes. */
type IndexedModel = { modelName: string; createIndexes(): Promise<unknown> };

/**
 * Collections added with Finance, Roles and Analytics. A database set up before them does not
 * have them, and on Vercel nothing builds their indexes: the startup setup does not run there
 * (src/instrumentation.ts) and Mongoose builds no indexes in production (src/server/db.ts). So
 * they are built here, once per process, before the first write (defineAction waits for it).
 * Only these collections are touched, never the ones that held data before. HR builds its own
 * (ensureHrIndexes in src/features/hr/server.ts).
 */
const NEW_COLLECTION_MODELS: IndexedModel[] = [
  AccountTransfer,
  BankAccount,
  BankPartyRule,
  BankStatement,
  BankTransaction,
  CapitalEntry,
  EquityHolder,
  FinanceGroup,
  FixedAsset,
  ForecastSnapshot,
  Investment,
  Invoice,
  Liability,
  Role,
  Scenario,
];

const globalForIndexes = globalThis as unknown as { __newCollectionIndexes?: Map<string, Promise<boolean>> };
const built = (globalForIndexes.__newCollectionIndexes ??= new Map<string, Promise<boolean>>());

/** True once the model's indexes exist. A failure is logged and tried again on the next call. */
function indexesOf(model: IndexedModel): Promise<boolean> {
  let pending = built.get(model.modelName);
  if (!pending) {
    pending = model.createIndexes().then(
      () => true,
      (error: unknown) => {
        console.error(`[db] could not create the indexes of ${model.modelName}; will try again`, error);
        built.delete(model.modelName);
        return false;
      },
    );
    built.set(model.modelName, pending);
  }
  return pending;
}

/** Builds the indexes of the new collections that do not have them yet. Never throws. Call after connectDB(). */
export async function ensureNewCollectionIndexes(): Promise<void> {
  await Promise.all(NEW_COLLECTION_MODELS.map(indexesOf));
}

/**
 * For writes that must not run without their unique index (a bank statement line is claimed by
 * one, so without it the same line could be added twice): stops before writing anything when the
 * index cannot be confirmed. Call after connectDB().
 */
export async function requireIndexes(...models: IndexedModel[]): Promise<void> {
  const ready = await Promise.all(models.map(indexesOf));
  if (ready.includes(false)) {
    throw new AppError(
      "The database is not ready for this yet, so nothing was saved. Try again in a minute. If it keeps happening, ask an admin to check the server log.",
    );
  }
}
