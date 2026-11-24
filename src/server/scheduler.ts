import "server-only";

import { postDueRecurringExpenses } from "@/server/services/recurring";
import { notifyStockAlerts } from "@/server/services/notifications";

const globalForScheduler = globalThis as unknown as { __recurringTimer?: ReturnType<typeof setInterval> };

const EVERY_MS = 30 * 60 * 1000;

/**
 * Posts due recurring expenses shortly after boot and every 30 minutes. With
 * several app instances each runs it; the occurrence keys keep posting exactly-once.
 * Each tick also sends the daily low-stock alerts, which run once per IST day however
 * often they are called (notifyStockAlerts claims the day).
 * External cron can call POST /api/cron/recurring instead (RECURRING_SCHEDULER=off).
 */
export function startRecurringScheduler() {
  if (globalForScheduler.__recurringTimer) return;
  const run = async () => {
    await postDueRecurringExpenses()
      .then((r) => r.posted && console.log(`[recurring] posted ${r.posted} expense(s) from ${r.schedules} schedule(s)`))
      .catch((error) => console.error("[recurring] run failed", error));
    await notifyStockAlerts()
      .then((r) => r.notified && console.log(`[stock-alerts] notified ${r.notified} of ${r.listed} item(s) to reorder`))
      .catch((error) => console.error("[stock-alerts] run failed", error));
  };
  setTimeout(run, 15_000).unref?.();
  globalForScheduler.__recurringTimer = setInterval(run, EVERY_MS);
  globalForScheduler.__recurringTimer.unref?.();
}
