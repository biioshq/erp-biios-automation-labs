import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer } from "@/features/analytics/viewer";
import { renderPdf } from "@/features/reports/server/render-pdf";
import { renderXlsx } from "@/features/reports/server/render-xlsx";
import { getScenarioDetail } from "@/features/analytics/scenarios/queries";
import { logScenarioExport, scenarioReport } from "@/features/analytics/scenarios/server/export";
import { toDateInput } from "@/lib/dates";

// jsPDF and ExcelJS need Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/** GET /api/analytics/scenarios/<id>/export?format=xlsx|pdf&basis=today|saved */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, ANALYTICS.scenarios.view) || !can(user, ANALYTICS.scenarios.export)) {
    return NextResponse.json({ error: "You do not have permission to do this." }, { status: 403 });
  }
  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const wantSaved = request.nextUrl.searchParams.get("basis") === "saved";

  try {
    // The same redaction as the page: salary and cash figures only with the matching data permission.
    const detail = await getScenarioDetail(id, analyticsViewer(user));
    if (!detail) return NextResponse.json({ error: "That scenario no longer exists." }, { status: 404 });
    const basis = wantSaved && detail.saved ? "saved" : "today";
    const results = basis === "saved" ? detail.saved : detail.live;
    if (!results) return NextResponse.json({ error: detail.liveError ?? "This scenario has no results to export." }, { status: 409 });
    const report = scenarioReport(detail, results, basis);
    const body = format === "pdf" ? renderPdf(report) : await renderXlsx(report);
    const fileName = `biios-scenario-${detail.code.toLowerCase()}-${basis === "saved" ? "as-saved" : toDateInput(new Date())}.${format}`;
    await logScenarioExport({ report, format, fileName, userId: user.id, filters: { scenarios: [id], basis } });
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Scenario export failed", error);
    return NextResponse.json({ error: "The file could not be generated. Try again." }, { status: 500 });
  }
}
