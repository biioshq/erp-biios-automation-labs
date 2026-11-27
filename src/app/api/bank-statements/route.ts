import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { StatementReadError } from "@/features/finance/bank-statements/server/errors";
import { readStatementFile } from "@/features/finance/bank-statements/server/read-file";

export const maxDuration = 60;

/** Below Vercel's 4.5 MB request limit, like the Excel import. A year of statement lines is a few hundred KB. */
const MAX_BYTES = 4 * 1024 * 1024;
/** The whole request: the file plus room for the multipart boundaries, part headers and the password field. */
const MAX_BODY = MAX_BYTES + 64 * 1024;

const tooLarge = () => NextResponse.json({ error: "Statements up to 4 MB can be uploaded. Download a shorter period and upload that." }, { status: 413 });

const CSV_ONLY = "Only CSV statements can be uploaded. Download the statement from net banking as CSV (comma-separated) and upload that file.";

/**
 * Why the file is not a CSV, judged from its first bytes (a name can be changed, the content cannot):
 * a PDF, an Excel workbook (.xlsx is a zip, old .xls is an OLE file or an HTML table), or binary data.
 * Null for text.
 */
function notCsv(head: Uint8Array): string | null {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "This file is a PDF renamed to .csv. Download the statement from net banking as CSV and upload that file.";
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0xd0, 0xcf, 0x11, 0xe0])) {
    return "This file is an Excel workbook renamed to .csv. Open it in Excel and save it as CSV (comma-separated), or download the CSV from net banking.";
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head).replace(/^\uFEFF/, "").trimStart().slice(0, 200).toLowerCase();
  if (text.startsWith("<html") || text.startsWith("<!doctype") || text.startsWith("<table") || text.startsWith("<?xml")) {
    return "This file is a web page or Excel export renamed to .csv, not a CSV. Download the statement from net banking as CSV and upload that file.";
  }
  // Text files have no NUL bytes; UTF-16 text does, and is read as text by the reader's own check.
  const utf16 = starts([0xff, 0xfe]) || starts([0xfe, 0xff]);
  if (!utf16 && head.includes(0)) return "This file is not a text CSV. Download the statement from net banking as CSV and upload that file.";
  return null;
}

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
 * POST multipart "file", a CSV statement only: the statement's rows, the row with its column names
 * and what each column holds, for the bank statement page. Anything that is not a CSV, by its name
 * or its content, is refused. Nothing is saved. Needs the bank statements create permission: what
 * it leads to creates money records across Finance.
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
  // CSV only: the name first, then the content, so a PDF or a workbook renamed to .csv is refused too.
  if (!/\.csv$/i.test(file.name.trim())) return NextResponse.json({ error: CSV_ONLY }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "This file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) return tooLarge();
  const bytes = Buffer.from(await file.arrayBuffer());
  const wrongKind = notCsv(bytes.subarray(0, 4096));
  if (wrongKind) return NextResponse.json({ error: wrongKind }, { status: 400 });
  try {
    const parsed = await readStatementFile(bytes, file.name);
    return NextResponse.json(parsed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StatementReadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[bank-statements] read failed", error);
    return NextResponse.json({ error: "This statement could not be read. Check it is the CSV download from your bank." }, { status: 500 });
  }
}
