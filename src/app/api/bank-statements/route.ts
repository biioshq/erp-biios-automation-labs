import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { StatementReadError } from "@/features/finance/bank-statements/server/errors";
import { formatOf, readStatementFile } from "@/features/finance/bank-statements/server/read-file";

export const maxDuration = 60;

/** Below Vercel's 4.5 MB request limit, like the Excel import. A year of statement lines is a few hundred KB. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST multipart "file" (CSV, .xlsx, .xls or PDF): the statement's rows, the row with its column
 * names and what each column holds, for the bank statement page. Nothing is saved. Admins only,
 * like the page: what it leads to creates money records across Finance.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only admins can upload bank statements." }, { status: 403 });
  const limited = rateLimit(`bank-statements:${user.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many uploads in a minute. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  if (!formatOf(file.name)) return NextResponse.json({ error: "Upload the statement as CSV, Excel (.xlsx or .xls) or PDF." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "This file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Statements up to 4 MB can be uploaded. Download a shorter period, or the CSV version, and upload that." }, { status: 413 });
  }
  try {
    const parsed = await readStatementFile(Buffer.from(await file.arrayBuffer()), file.name);
    return NextResponse.json(parsed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StatementReadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[bank-statements] read failed", error);
    return NextResponse.json({ error: "This statement could not be read. Try the CSV or Excel download from your bank." }, { status: 500 });
  }
}
