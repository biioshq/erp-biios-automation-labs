import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { changeVersion } from "@/server/changes";

export const dynamic = "force-dynamic";

/** The company-wide change counter, for <LiveUpdates>. Signed-in users only. */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ v: await changeVersion() }, { headers: { "Cache-Control": "no-store" } });
}
