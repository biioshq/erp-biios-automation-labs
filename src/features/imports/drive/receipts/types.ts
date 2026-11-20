import type { FileDTO } from "@/features/files/types";
import type { ExpenseFormInput } from "@/features/finance/expenses/schemas";
import type { ExpenseCategoryOption } from "@/lib/expense-categories";

/** Drive receipt import: what the client sees. Client-safe. */

/** What happens to a file in the folder when it is imported. */
export type DriveReceiptState =
  /** Not imported yet: it will be read. */
  | "new"
  /** A draft for it is waiting for review. */
  | "draft"
  /** Saved as an expense already. */
  | "saved"
  /** Discarded before: skipped unless "include discarded files" is ticked. */
  | "discarded"
  /** Over the upload limit. */
  | "too_large"
  /** A type the receipt reader does not handle (HEIC, GIF ...). */
  | "unsupported";

export type DriveReceiptFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  state: DriveReceiptState;
  /** Why it is skipped (too_large, unsupported), or a note on its state. */
  reason: string | null;
  /** Needed to read files shared with an older link; sent back when importing. */
  resourceKey: string | null;
};

export type DriveReceiptListing = {
  /** The shared folder, or null for a single file link. */
  folderId: string | null;
  folderResourceKey: string | null;
  files: DriveReceiptFile[];
  counts: Record<DriveReceiptState, number>;
};

/** The review form's values: the expense form's, without the receipt (the draft holds it). */
export type DraftFormValues = Omit<ExpenseFormInput, "receiptId" | "ocr">;

export type ReceiptDraft = {
  id: string;
  driveFileId: string;
  fileName: string;
  status: "reading" | "ready" | "saving";
  file: FileDTO | null;
  values: DraftFormValues;
  /** Confidence per form path ("gst.gstin") for the fields filled from the receipt. */
  confidence: Record<string, number>;
  overallConfidence: number | null;
  ocrError: string | null;
  /** Possible duplicates: other expenses or drafts that look like the same bill. */
  duplicates: string[];
  createdAt: string;
  createdBy: string | null;
};

export type ReceiptDraftsData = {
  drafts: ReceiptDraft[];
  /** All drafts waiting for review; more than drafts.length when only the newest are listed. */
  total: number;
  projects: import("@/server/lookups").ProjectOption[];
  categories: ExpenseCategoryOption[];
};

/** What the process route answers for one file. */
export type ProcessReceiptResponse =
  | { status: "created"; draft: ReceiptDraft; ocrError: string | null }
  | { status: "reread"; draft: ReceiptDraft; ocrError: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; stop: boolean };

/** One draft's outcome in "Save all checked". */
export type SaveDraftOutcome = { id: string; ok: true; expenseId: string; number: string } | { id: string; ok: false; error: string };
