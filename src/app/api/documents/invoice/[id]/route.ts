import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { buildInvoiceDocument } from "@/features/documents/server/data";
import { renderDocument } from "@/features/documents/server/render-document";

// jsPDF needs Node APIs and the fonts and logo on disk.
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/** GET /api/documents/invoice/<id>: the invoice as a PDF, built from the stored record each time. Needs finance.invoices:view. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/documents/invoice/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "finance.invoices:view")) {
    return NextResponse.json({ error: "You do not have permission to download invoices." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const built = await buildInvoiceDocument(id);
    if (!built) return NextResponse.json({ error: "That invoice was not found." }, { status: 404 });
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
    console.error("Invoice PDF failed", error);
    return NextResponse.json({ error: "The invoice could not be generated." }, { status: 500 });
  }
}
