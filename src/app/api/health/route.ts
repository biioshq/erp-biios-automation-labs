import { NextResponse, type NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/server/db";
import { checkStorage, storageDriverName, type StorageCheck } from "@/server/storage";
import { getCurrentUser } from "@/server/auth/session";
import { googleStatus } from "@/server/auth/google";
import { checkReader, type ReaderCheck } from "@/server/ocr/check";

export const dynamic = "force-dynamic";
// The admin reader check (?check=ocr) can take a few seconds on a cold start.
export const maxDuration = 60;

/**
 * Liveness and database readiness for load balancers and uptime checks. No auth, no data.
 * For a signed-in admin, `?check=storage` also uploads, reads and deletes a test file to prove the
 * file storage settings (Cloudinary) work, and `?check=ocr` reads a test image with the receipt
 * reader. `?check=storage,ocr` runs both.
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
  const checks = new Set((request.nextUrl.searchParams.get("check") ?? "").split(",").map((c) => c.trim()));
  let storageCheck: StorageCheck | string | undefined;
  let ocrCheck: ReaderCheck | string | undefined;
  if (checks.has("storage") || checks.has("ocr")) {
    const admin = (await getCurrentUser().catch(() => null))?.role === "admin";
    const denied = "Sign in as an admin to run this check.";
    if (checks.has("storage")) storageCheck = admin ? await checkStorage() : denied;
    if (checks.has("ocr")) ocrCheck = admin ? await checkReader() : denied;
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
      ...(ocrCheck ? { ocrCheck } : {}),
      uptime: Math.round(process.uptime()),
      latencyMs: Math.round(performance.now() - started),
    },
    { status: db === "up" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
