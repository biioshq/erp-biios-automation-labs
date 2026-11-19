import { NextResponse, type NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/server/db";
import { checkStorage, storageDriverName, type StorageCheck } from "@/server/storage";
import { getCurrentUser } from "@/server/auth/session";
import { googleStatus } from "@/server/auth/google";

export const dynamic = "force-dynamic";

/**
 * Liveness and database readiness for load balancers and uptime checks. No auth, no data.
 * `?check=storage`, for a signed-in admin, also uploads, reads and deletes a test file to prove
 * the file storage settings (Cloudinary) work.
 */
export async function GET(request: NextRequest) {
  const started = performance.now();
  let db: "up" | "down" = "down";
  try {
    await connectDB();
    await mongoose.connection.db!.admin().ping();
    db = "up";
  } catch {
    db = "down";
  }
  let storageCheck: StorageCheck | string | undefined;
  if (request.nextUrl.searchParams.get("check") === "storage") {
    const user = await getCurrentUser().catch(() => null);
    storageCheck = user?.role === "admin" ? await checkStorage() : "Sign in as an admin to run the storage check.";
  }
  // Whether "Continue with Google" shows on the sign-in page, and why not. Never includes values.
  const google = googleStatus();
  return NextResponse.json(
    {
      status: db === "up" ? "ok" : "degraded",
      db,
      storage: storageDriverName(),
      googleSignIn: google.enabled ? "on" : `off: ${google.problems.join(" ")}`,
      ...(storageCheck ? { storageCheck } : {}),
      uptime: Math.round(process.uptime()),
      latencyMs: Math.round(performance.now() - started),
    },
    { status: db === "up" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
