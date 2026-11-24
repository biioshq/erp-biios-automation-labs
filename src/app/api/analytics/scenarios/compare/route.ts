import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { renderPdf } from "@/features/reports/server/render-pdf";
import { renderXlsx } from "@/features/reports/server/render-xlsx";
import { getComparison } from "@/features/analytics/scenarios/queries";
import { comparisonReport, logScenarioExport } from "@/features/analytics/scenarios/server/export";
import { toDateInput } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/** GET /api/analytics/scenarios/compare?ids=a,b,c&basis=today|saved&format=xlsx|pdf */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "Pick at least one scenario." }, { status: 400 });

  try {
    const data = await getComparison(ids, sp.get("basis") === "saved" ? "saved" : "today", { admin: user.role === "admin" });
    if (!data.columns.length) return NextResponse.json({ error: "None of those scenarios exists." }, { status: 404 });
    const report = comparisonReport(data.columns, data.rows);
    const body = format === "pdf" ? renderPdf(report) : await renderXlsx(report);
    const fileName = `biios-scenario-comparison-${toDateInput(new Date())}.${format}`;
    await logScenarioExport({
      report,
      format,
      fileName,
      userId: user.id,
      filters: { scenarios: data.columns.map((c) => c.id), basis: sp.get("basis") === "saved" ? "saved" : "today" },
    });
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
    console.error("Scenario comparison export failed", error);
    return NextResponse.json({ error: "The file could not be generated. Try again." }, { status: 500 });
  }
}
