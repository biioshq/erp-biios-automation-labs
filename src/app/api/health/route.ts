import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/server/db";
import { storageDriverName } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Liveness and database readiness for load balancers and uptime checks. No auth, no data. */
export async function GET() {
  const started = performance.now();
  let db: "up" | "down" = "down";
  try {
    await connectDB();
    await mongoose.connection.db!.admin().ping();
    db = "up";
  } catch {
    db = "down";
  }
  return NextResponse.json(
    {
      status: db === "up" ? "ok" : "degraded",
      db,
      storage: storageDriverName(),
      uptime: Math.round(process.uptime()),
      latencyMs: Math.round(performance.now() - started),
    },
    { status: db === "up" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
