import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { StatementReadError } from "@/features/finance/bank-statements/server/errors";
import { MAX_PDF_PASSWORD, PdfPasswordError } from "@/features/finance/bank-statements/server/pdf";
import { formatOf, readStatementFile } from "@/features/finance/bank-statements/server/read-file";
import { ExcelReadError } from "@/features/imports/csv/excel";

export const maxDuration = 60;

/** Below Vercel's 4.5 MB request limit, like the Excel import. A year of statement lines is a few hundred KB. */
const MAX_BYTES = 4 * 1024 * 1024;
/** The whole request: the file plus room for the multipart boundaries, part headers and the password field. */
const MAX_BODY = MAX_BYTES + 64 * 1024;

const tooLarge = () =>
  NextResponse.json({ error: "Statements up to 4 MB can be uploaded. Download a shorter period, or the CSV version, and upload that." }, { status: 413 });

/**
 * The request body, read until `max` bytes and no further ("too-large" past that), so an oversized
 * upload is refused before it is held in memory and parsed. Null without a body.
 */
async function readBody(request: NextRequest, max: number): Promise<Uint8Array<ArrayBuffer> | null | "too-large"> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return "too-large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * POST multipart "file" (CSV, .xlsx, .xls or PDF), and "password" for a locked PDF: the statement's
 * rows, the row with its column names and what each column holds, for the bank statement page. A
 * locked PDF without the right password answers 400 with `needsPassword` ("missing" or "wrong"). Nothing is saved. Needs the bank
 * statements create permission: what it leads to creates money records across Finance.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  if (!can(user, "finance.bank_statements:create")) return NextResponse.json({ error: "You do not have permission to upload bank statements." }, { status: 403 });
  const limited = rateLimit(`bank-statements:${user.id}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many uploads in a minute. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  // The size is checked before the body is read: first the declared length, then while reading.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY) return tooLarge();
  const body = await readBody(request, MAX_BODY).catch(() => null);
  if (body === "too-large") return tooLarge();
  const form = body
    ? await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData().catch(() => null)
    : null;
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  if (!formatOf(file.name)) return NextResponse.json({ error: "Upload the statement as CSV, Excel (.xlsx or .xls) or PDF." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "This file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) return tooLarge();
  // A locked PDF's password, typed by the admin. Only handed to the PDF reader: never logged, stored or sent back.
  const rawPassword = form?.get("password");
  const password = typeof rawPassword === "string" && rawPassword !== "" ? rawPassword : undefined;
  if (password && password.length > MAX_PDF_PASSWORD) {
    return NextResponse.json({ error: `A PDF password has at most ${MAX_PDF_PASSWORD} characters.`, needsPassword: "wrong" }, { status: 400 });
  }
  try {
    const parsed = await readStatementFile(Buffer.from(await file.arrayBuffer()), file.name, { password });
    return NextResponse.json(parsed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PdfPasswordError) {
      return NextResponse.json({ error: error.message, needsPassword: error.reason }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof StatementReadError) return NextResponse.json({ error: error.message }, { status: 400 });
    // The reader turns these into StatementReadError; kept here too, as its message is written for the admin.
    if (error instanceof ExcelReadError) return NextResponse.json({ error: error.message }, { status: 400 });
    // Only the error goes to the log: the request, and with it any password, does not.
    console.error("[bank-statements] read failed", error);
    return NextResponse.json({ error: "This statement could not be read. Try the CSV or Excel download from your bank." }, { status: 500 });
  }
}
