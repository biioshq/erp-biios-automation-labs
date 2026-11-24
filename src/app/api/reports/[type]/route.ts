import { NextResponse, type NextRequest } from "next/server";
import { connectDB } from "@/server/db";
import { Report } from "@/server/models";
import { can, getCurrentUser } from "@/server/auth/session";
import { bumpChanges } from "@/server/changes";
import { mayExportReport } from "@/features/reports/catalog";
import { parseReportRequest } from "@/features/reports/schemas";
import { buildReport, rowCountOf } from "@/features/reports/server/build";
import { CONTENT_TYPES, reportFileName, renderReport } from "@/features/reports/server/export";

// jsPDF and ExcelJS need Node APIs.
export const runtime = "nodejs";
// Large CA packs can take a few seconds to render as PDF.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** GET /api/reports/<type>?format=pdf|xlsx|csv&from=&to=&project=&vendor=&category= */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/reports/[type]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  const parsed = parseReportRequest(type, request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  // Each report needs the export permission of its area (see reportPermissions in the catalog).
  // The movement history (Inventory > Movements export) is the inventory area's own list.
  const movementHistory = parsed.type === "inventory" && request.nextUrl.searchParams.get("movements") === "1";
  const allowed = movementHistory ? can(user, "inventory.movements:export") : mayExportReport(parsed.type, (p) => can(user, p));
  if (!allowed) return NextResponse.json({ error: "You do not have permission to download this report." }, { status: 403 });

  try {
    const report = await buildReport(parsed.type, parsed.filters);
    const body = await renderReport(report, parsed.format);
    const fileName = reportFileName(parsed.type, parsed.format, parsed.filters);
    const rowCount = rowCountOf(report);

    // The export log must never block a download.
    try {
      await connectDB();
      await Report.create({
        type: parsed.type,
        format: parsed.format,
        title: report.title,
        filters: parsed.filters,
        rowCount,
        fileName,
        generatedBy: user.id,
      });
      // A slow export can finish after the page's own refresh; this makes open report pages list it.
      await bumpChanges();
    } catch (error) {
      console.error("Could not log report export", error);
    }

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": CONTENT_TYPES[parsed.format],
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Report-Rows": String(rowCount),
      },
    });
  } catch (error) {
    console.error("Report export failed", error);
    return NextResponse.json({ error: "The report could not be generated. Try a smaller date range." }, { status: 500 });
  }
}
