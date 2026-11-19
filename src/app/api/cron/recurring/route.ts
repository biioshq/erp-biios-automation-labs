import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { postDueRecurringExpenses } from "@/server/services/recurring";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const maxDuration = 60;

/**
 * Posts due recurring expenses. Called by Vercel Cron (GET, see vercel.json) or any external
 * scheduler (POST), with "Authorization: Bearer $CRON_SECRET". Exactly-once per due date.
 */
async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await postDueRecurringExpenses();
  return NextResponse.json(result);
}

export const GET = run;
export const POST = run;
