/**
 * The MongoDB database every collection lives in, whatever database the connection string names
 * (so Atlas strings without a database part work too). Override with MONGODB_DB, for example to
 * keep preview deployments apart from production.
 */
export const DB_NAME = process.env.MONGODB_DB || "erp-biios-automation-labs";

/** Databases used before the rename. Their data is copied over once (adoptLegacyDatabase in setup-db.ts). */
export const LEGACY_DB_NAMES = ["biios_erp", "biios_pm"];
