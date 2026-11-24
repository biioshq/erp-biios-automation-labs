import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
import { CSV_IMPORT_KINDS, type CsvImportKind } from "@/features/imports/csv/fields";
import { ExcelReadError, readWorkbook, templateWorkbook } from "@/features/imports/csv/excel";

export const maxDuration = 60;

/** Items are imported under Inventory, expenses and income under Finance. Without a kind, either is enough. */
function mayImport(user: SessionUser, kind: CsvImportKind | null): boolean {
  if (kind === "items") return can(user, "inventory.import:create");
  if (kind) return can(user, "finance.import:create");
  return can(user, "finance.import:create") || can(user, "inventory.import:create");
}

/** Below Vercel's 4.5 MB request limit. A 2,000-row import sheet is a few hundred KB. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST multipart "file" (.xlsx) and optional "sheet": the rows of that sheet (or the first sheet
 * with data) as { sheets, sheet, headers, rows }, for the import panel. Needs the import permission
 * of the kind's area (Finance for expenses and income, Inventory for items), like the imports.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  if (!mayImport(user, null)) return NextResponse.json({ error: "You do not have permission to import." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Pick an Excel workbook (.xlsx) or a CSV file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Excel files up to 4 MB can be imported. Split it into smaller files or save it as CSV." }, { status: 413 });
  const sheet = form?.get("sheet");
  const kindRaw = form?.get("kind");
  const kind = typeof kindRaw === "string" && (CSV_IMPORT_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as CsvImportKind) : null;
  if (!mayImport(user, kind)) return NextResponse.json({ error: "You do not have permission to import." }, { status: 403 });
  try {
    const parsed = await readWorkbook(Buffer.from(await file.arrayBuffer()), typeof sheet === "string" && sheet ? sheet : null, kind);
    return NextResponse.json(parsed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExcelReadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[import] excel read failed", error);
    return NextResponse.json({ error: "This Excel file could not be read." }, { status: 500 });
  }
}

/** GET ?kind=expenses|income|items: the import template as an Excel workbook (same permission as the import). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  const kind = request.nextUrl.searchParams.get("kind") as CsvImportKind | null;
  if (!kind || !(CSV_IMPORT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Unknown template." }, { status: 400 });
  if (!mayImport(user, kind)) return NextResponse.json({ error: "You do not have permission to import." }, { status: 403 });
  const bytes = await templateWorkbook(kind);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${kind}-template.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
