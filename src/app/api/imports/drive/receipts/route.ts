import { NextResponse, type NextRequest } from "next/server";
import { Types } from "mongoose";
import { can, getCurrentUser } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { importDriveReceipt, rereadDraft } from "@/features/imports/drive/receipts/server";
import type { ProcessReceiptResponse } from "@/features/imports/drive/receipts/types";

// A download plus up to 40 s of reading. The receipt reader's files must be traced for this route
// (outputFileTracingIncludes in next.config.ts), as for /api/ocr.
export const maxDuration = 60;

/**
 * Imports one Google Drive bill as a draft expense, one file per request, so the browser shows
 * progress and can stop between files. Needs the Finance import permission.
 *
 *   POST { driveFileId, folderId?, includeDiscarded?, resourceKey?, folderResourceKey? }
 *                                                         download, store, read, save a draft
 *   POST { draftId }                                      read a draft's stored bill again
 *
 * Answers 200 with { status: "created" | "reread" | "skipped" | "failed" } for anything about the
 * file itself; `stop: true` on a failure that would repeat for every following file.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  if (!can(user, "finance.import:create")) return NextResponse.json({ error: "You do not have permission to import bills." }, { status: 403 });
  const limited = rateLimit(`drive-receipts:${user.id}`, 40, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many files in a minute. Wait a moment, then continue." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    driveFileId?: unknown;
    folderId?: unknown;
    includeDiscarded?: unknown;
    resourceKey?: unknown;
    folderResourceKey?: unknown;
    draftId?: unknown;
  } | null;

  let result: ProcessReceiptResponse;
  try {
    await connectDB();
    if (typeof body?.draftId === "string") {
      if (!Types.ObjectId.isValid(body.draftId)) return NextResponse.json({ error: "No draft was given." }, { status: 400 });
      result = await rereadDraft(body.draftId, { startedAt });
    } else {
      const driveFileId = typeof body?.driveFileId === "string" ? body.driveFileId : "";
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(driveFileId)) return NextResponse.json({ error: "No Drive file was given." }, { status: 400 });
      const folderId = typeof body?.folderId === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(body.folderId) ? body.folderId : null;
      // Resource keys: for files shared with an older link (?resourcekey=).
      const key = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null);
      result = await importDriveReceipt(
        {
          driveFileId,
          folderId,
          includeDiscarded: body?.includeDiscarded === true,
          resourceKey: key(body?.resourceKey),
          folderResourceKey: folderId ? key(body?.folderResourceKey) : null,
        },
        user,
        { startedAt },
      );
    }
  } catch (error) {
    console.error("[drive-receipts] request failed", error);
    return NextResponse.json({ status: "failed", error: "Importing failed on the server. Try again in a moment.", stop: false } satisfies ProcessReceiptResponse);
  }
  // Drafts show only on this panel, so other people's pages are not refreshed for each file.
  return NextResponse.json(result);
}
