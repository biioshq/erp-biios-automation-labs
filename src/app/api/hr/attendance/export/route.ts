import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { monthInput } from "@/features/hr/schemas";
import { monthOf, todayIST } from "@/features/hr/server";
import { getRegister } from "@/features/hr/register/queries";
import { REGISTER_CONTENT_TYPES, registerFileName, renderRegister, type RegisterFormat } from "@/features/hr/register/export";

// ExcelJS needs Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hr/attendance/export?month=YYYY-MM&format=xlsx|csv
 * The monthly register as a file. Needs "hr.attendance:export". Holds no salary amounts.
 * Reads only: it does not log the download anywhere.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "hr.attendance:export")) {
    return NextResponse.json({ error: "You do not have permission to download the attendance register." }, { status: 403 });
  }

  const search = request.nextUrl.searchParams;
  const month = monthInput.safeParse(search.get("month") ?? monthOf(todayIST()));
  const year = month.success ? Number(month.data.slice(0, 4)) : 0;
  if (!month.success || year < 2000 || year > 2100) return NextResponse.json({ error: "Pick a month, like 2026-11." }, { status: 400 });
  const formatParam = search.get("format") ?? "xlsx";
  if (formatParam !== "xlsx" && formatParam !== "csv") return NextResponse.json({ error: "The format must be xlsx or csv." }, { status: 400 });
  const format: RegisterFormat = formatParam;

  try {
    const register = await getRegister(month.data);
    const body = await renderRegister(register, format);
    const fileName = registerFileName(month.data, format);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": REGISTER_CONTENT_TYPES[format],
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Attendance register export failed", error);
    return NextResponse.json({ error: "The register could not be generated. Try again." }, { status: 500 });
  }
}
