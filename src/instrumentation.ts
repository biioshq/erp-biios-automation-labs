/**
 * Runs once when the server starts: checks the environment, makes sure every
 * MongoDB collection and index exists, then starts the recurring-expense scheduler.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateEnv } = await import("./server/env");
  const env = validateEnv();

  // Serverless (Vercel): no long-lived process. Run `npm run db:setup` once per database, and
  // recurring expenses are posted by Vercel Cron calling /api/cron/recurring (vercel.json).
  if (process.env.VERCEL) return;

  try {
    const { ensureDatabase } = await import("./server/setup-db");
    const result = await ensureDatabase();
    console.log(`[startup] database ready: ${result.collections} collections, ${result.indexes} indexes`);
  } catch (error) {
    // Pages show a clear "database not reachable" state; keep the server up so it recovers when MongoDB does.
    console.error("[startup] could not prepare the database", error);
  }

  if (env.RECURRING_SCHEDULER !== "off") {
    const { startRecurringScheduler } = await import("./server/scheduler");
    startRecurringScheduler();
  }
}
