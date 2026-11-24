"use server";

import { z } from "zod";
import { defineAction } from "@/server/action";
import { saveMonthForecast } from "./server/snapshots";

/**
 * Stores this month's material demand and project cost forecasts so they can be compared with what
 * happens. Only rows missing for the month are written; a stored forecast is never changed, so
 * running it again does nothing new.
 */
export const saveMonthForecastAction = defineAction(z.object({}), async () => saveMonthForecast(), {
  role: "admin",
  revalidate: [["/analytics", "layout"]],
});
