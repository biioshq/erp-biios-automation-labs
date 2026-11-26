import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { buildReceiptDocument } from "@/features/documents/server/data";
import { renderDocument } from "@/features/documents/server/render-document";

// jsPDF needs Node APIs and the fonts and logo on disk.
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/documents/receipt/<id>: the payment receipt of an income record as a PDF. Needs
 * finance.income:view. The invoice it settles is shown with its totals and tax only to people who
 * may also view invoices; others see just the invoice number.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/documents/receipt/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "finance.income:view")) {
    return NextResponse.json({ error: "You do not have permission to download receipts." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const built = await buildReceiptDocument(id, { includeInvoice: can(user, "finance.invoices:view") });
    if (!built) return NextResponse.json({ error: "That income record was not found." }, { status: 404 });
    const body = renderDocument(built.spec, built.company);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${built.fileName}"; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Receipt PDF failed", error);
    return NextResponse.json({ error: "The receipt could not be generated." }, { status: 500 });
  }
}
