import "server-only";

import { Types } from "mongoose";
import { AppError, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/session";
import { Expense, ExpenseDraft, FileModel, InventoryMovement, type ExpenseDraftDoc } from "@/server/models";
import { MAX_UPLOAD_BYTES, UploadError } from "@/server/storage";
import { DriveError, downloadDriveFile, getDriveFile, isImageOrPdf, listDriveFolder, parseDriveLink, type ResourceKeys } from "@/server/google-drive";
import { attachFiles, getFiles, removeFile, storeBuffer } from "@/features/files/server";
import { assertExpenseCategoryAllowed } from "@/server/expense-categories";
import { iso } from "@/server/serialize";
import { withAuditContext } from "@/server/audit";
import { OCR_MIME_TYPES, type InvoiceExtraction } from "@/lib/ocr";
import { PAYMENT_METHODS } from "@/lib/constants";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import { gstGrandTotal } from "@/lib/gst";
import type { ActionResult } from "@/lib/action-result";
import type { ExpenseFormInput } from "@/features/finance/expenses/schemas";
import { draftValuesSchema, type DraftValuesInput } from "./schemas";
import type {
  DraftFormValues,
  DriveReceiptFile,
  DriveReceiptListing,
  DriveReceiptState,
  ProcessReceiptResponse,
  ReceiptDraft,
  SaveDraftOutcome,
} from "./types";

/**
 * Google Drive bills to draft expenses. Plain functions that take the signed-in user, so the
 * route, the actions and test scripts share them. Every caller checks the user is an admin.
 *
 * Nothing here changes an existing expense or file: a draft only ever owns the receipt it stored
 * itself, and becomes an expense through the expense form's own create logic.
 */

const OPEN_STATUSES = ["reading", "ready", "saving"] as const;
/** A draft left "reading" this long was cut off (the server stopped); it is opened for review. */
const STALE_READING_MS = 3 * 60_000;
/** A draft left "saving" this long is checked against the expenses and settled. */
const STALE_SAVING_MS = 2 * 60_000;
/** The process request stops reading at this point, inside the route's 60 s limit. */
const PROCESS_BUDGET_MS = 52_000;

const MB = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
const LIMIT_LABEL = `${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
const isReadable = (mimeType: string) => (OCR_MIME_TYPES as readonly string[]).includes(mimeType);
const PAYMENT_VALUES = new Set<string>(PAYMENT_METHODS.map((m) => m.value).filter((v) => v !== "stock"));
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ---------- values ---------- */

function emptyValues(fileName: string): DraftValuesInput {
  return {
    vendor: "",
    vendorAddress: "",
    category: "",
    description: "",
    date: toDateInput(new Date()),
    paymentMethod: "bank_transfer",
    notes: `From Google Drive: ${fileName}`.slice(0, 4000),
    gst: { gstin: "", invoiceNumber: "", hsnSac: "" },
  };
}

/** Stored values, cleaned up (a draft written by an older version or by hand never breaks the form). */
function storedValues(doc: Pick<ExpenseDraftDoc, "values" | "fileName">): ReturnType<typeof draftValuesSchema.parse> {
  const raw = withoutNulls(doc.values ?? {}) as Record<string, unknown>;
  const parsed = draftValuesSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Keep every field that is still valid; only the broken ones fall back to empty.
  const fallback = draftValuesSchema.parse(emptyValues(doc.fileName)) as Record<string, unknown>;
  const broken = new Set(parsed.error.issues.map((i) => String(i.path[0])));
  const kept = Object.fromEntries(Object.entries(raw).filter(([k]) => !broken.has(k)));
  return draftValuesSchema.parse({ ...fallback, ...kept });
}

/** Values without null or undefined fields (a stored undefined reads back as null). */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  }
  return value;
}

function toFormValues(doc: Pick<ExpenseDraftDoc, "values" | "fileName">): DraftFormValues {
  const v = storedValues(doc);
  const g = v.gst ?? {};
  return {
    vendor: v.vendor,
    vendorAddress: v.vendorAddress,
    projectId: v.projectId,
    stage: v.projectId ? v.stage : undefined,
    category: v.category as DraftFormValues["category"],
    description: v.description,
    amount: v.amount as number,
    date: v.date ?? toDateInput(new Date()),
    paymentMethod: v.paymentMethod,
    notes: v.notes,
    gst: {
      gstin: g.gstin ?? "",
      invoiceNumber: g.invoiceNumber ?? "",
      invoiceDate: g.invoiceDate,
      taxableAmount: g.taxableAmount || undefined,
      cgst: g.cgst || undefined,
      sgst: g.sgst || undefined,
      igst: g.igst || undefined,
      cess: g.cess || undefined,
      hsnSac: g.hsnSac ?? "",
      grandTotal: g.grandTotal || undefined,
    },
  };
}

type OcrSummary = { overall: number; source: string; fields: Record<string, number> };

/**
 * What the receipt reader found, as the expense form would fill it (see applyOcr in the expense
 * form), with a confidence per form field. Keys use "__" for "." (stored as Mongo keys).
 *
 * Fields are filled only when they are empty, so reading again keeps what someone typed. Three
 * fields are not "empty" or not: the expense date and the payment method always hold a value,
 * and the amount follows taxable value plus GST.
 *   - The expense date moves to the invoice date on the first read (`firstRead`), or later when it
 *     is still the import day and was never set from the bill (`dateIsDefault`).
 *   - The payment method is set only on the first read.
 *   - The amount follows taxable value plus GST whenever a taxable value is set, as in the form.
 */
export function fillFromOcr(
  current: DraftValuesInput,
  f: InvoiceExtraction,
  options: { firstRead: boolean; dateIsDefault?: boolean },
): { values: DraftValuesInput; confidence: Record<string, number>; filled: number } {
  const values: DraftValuesInput = { ...current, gst: { ...(current.gst ?? {}) } };
  const gst = values.gst!;
  const confidence: Record<string, number> = {};
  let filled = 0;
  const has = (value: unknown) => value !== null && value !== undefined && value !== "";
  const put = (path: string, field: { value: unknown; confidence: number }, target: Record<string, unknown>, key: string) => {
    if (!has(field.value) || has(target[key])) return;
    target[key] = field.value;
    confidence[path.replaceAll(".", "__")] = field.confidence;
    filled++;
  };
  const top = values as Record<string, unknown>;
  const g = gst as Record<string, unknown>;
  put("vendor", f.vendorName, top, "vendor");
  put("vendorAddress", f.vendorAddress, top, "vendorAddress");
  put("gst.gstin", f.gstin, g, "gstin");
  put("gst.invoiceNumber", f.invoiceNumber, g, "invoiceNumber");
  put("gst.invoiceDate", f.invoiceDate, g, "invoiceDate");
  // The expense date follows the invoice date read from the bill (the draft starts on the import day).
  if (f.invoiceDate.value && (options.firstRead || options.dateIsDefault) && values.date !== f.invoiceDate.value) {
    values.date = f.invoiceDate.value;
    confidence.date = f.invoiceDate.confidence;
    filled++;
  }
  put("gst.taxableAmount", f.taxableAmount, g, "taxableAmount");
  put("gst.cgst", f.cgst, g, "cgst");
  put("gst.sgst", f.sgst, g, "sgst");
  put("gst.igst", f.igst, g, "igst");
  put("gst.cess", f.cess, g, "cess");
  put("gst.hsnSac", f.hsnSac, g, "hsnSac");
  put("amount", f.totalAmount, top, "amount");
  const taxable = Number(gst.taxableAmount ?? 0);
  if (taxable > 0) {
    // As in the expense form, the amount follows taxable value plus GST whenever a taxable value is set.
    gst.grandTotal = gstGrandTotal(gst as Parameters<typeof gstGrandTotal>[0]);
    values.amount = gst.grandTotal;
  } else if (has(values.amount)) {
    gst.grandTotal = Number(values.amount);
  }
  if (options.firstRead && f.paymentMethod.value && PAYMENT_VALUES.has(f.paymentMethod.value)) {
    values.paymentMethod = f.paymentMethod.value as DraftValuesInput["paymentMethod"];
    confidence.paymentMethod = f.paymentMethod.confidence;
    filled++;
  }
  return { values, confidence, filled };
}

/** The expense form's input for a draft: its values, its stored receipt and what the reader found. */
function toExpenseInput(doc: ExpenseDraftDoc, fileId: string | undefined): ExpenseFormInput {
  const v = toFormValues(doc);
  const ocr = doc.ocr as OcrSummary | undefined;
  return {
    ...v,
    receiptId: fileId,
    ocr: ocr && typeof ocr.overall === "number" ? { overall: ocr.overall, source: String(ocr.source ?? "").slice(0, 20), fields: cleanConfidences(ocr.fields) } : undefined,
  };
}

function cleanConfidences(fields: unknown): Record<string, number> {
  if (!fields || typeof fields !== "object") return {};
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).filter(([, c]) => typeof c === "number" && c >= 0 && c <= 1) as [string, number][],
  );
}

/* ---------- listing a folder ---------- */

/** Saved drafts whose expense was deleted since: their Drive file may be imported again. */
async function withDeletedExpense(drafts: { _id: Types.ObjectId; status: string; expense?: Types.ObjectId | null }[]): Promise<Set<string>> {
  const saved = drafts.filter((d) => d.status === "saved");
  if (!saved.length) return new Set();
  const ids = saved.map((d) => d.expense).filter((id): id is Types.ObjectId => Boolean(id));
  const existing = new Set((ids.length ? await Expense.find({ _id: { $in: ids } }, { _id: 1 }).lean() : []).map((e) => String(e._id)));
  return new Set(saved.filter((d) => !d.expense || !existing.has(String(d.expense))).map((d) => String(d._id)));
}

const EXPENSE_DELETED = "Saved before, but that expense was deleted. Tick the option to import discarded files again.";

/** The images and PDFs in a shared folder (or one shared file), and what an import would do with each. */
export async function listDriveReceipts(link: string): Promise<DriveReceiptListing> {
  const parsed = parseDriveLink(link);
  if (!parsed) throw new DriveError("That does not look like a Google Drive folder or file link.");
  const { folderId, folderResourceKey, files } = await listDriveFolder(link, isImageOrPdf);
  const drafts = files.length
    ? await ExpenseDraft.find({ driveFileId: { $in: files.map((f) => f.id) } }, { driveFileId: 1, status: 1, expense: 1 }).lean()
    : [];
  const gone = await withDeletedExpense(drafts);
  // A file can have an old discarded draft and a newer one: the newer state wins.
  const byFile = new Map<string, { state: DriveReceiptState; reason: string | null }>();
  for (const d of drafts) {
    const deleted = gone.has(String(d._id));
    const state: DriveReceiptState = deleted ? "discarded" : d.status === "saved" ? "saved" : d.status === "discarded" ? "discarded" : "draft";
    const before = byFile.get(d.driveFileId);
    if (!before || before.state === "discarded") byFile.set(d.driveFileId, { state, reason: deleted ? EXPENSE_DELETED : null });
  }
  const out: DriveReceiptFile[] = files.map((f) => {
    const base = { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, resourceKey: f.resourceKey ?? null };
    const known = byFile.get(f.id);
    if (known) return { ...base, state: known.state, reason: known.reason };
    if (!isReadable(f.mimeType)) {
      return { ...base, state: "unsupported", reason: "Only PNG, JPEG and WebP images and PDFs can be read. Save it as JPEG or PDF." };
    }
    if (f.size !== null && f.size > MAX_UPLOAD_BYTES) {
      return { ...base, state: "too_large", reason: `${MB(f.size)}, over the ${LIMIT_LABEL} limit per file.` };
    }
    return { ...base, state: "new", reason: null };
  });
  const counts = { new: 0, draft: 0, saved: 0, discarded: 0, too_large: 0, unsupported: 0 } satisfies Record<DriveReceiptState, number>;
  for (const f of out) counts[f.state]++;
  return { folderId, folderResourceKey, files: out, counts };
}

/* ---------- importing one file ---------- */

/** Problems that would fail every following file the same way: the browser stops the run. */
function stopsTheRun(error: DriveError | UploadError) {
  return error.status === 503 || error.status === 401 || error.status === 403 || error.status === 429;
}

type Reader = (file: Buffer, mimeType: string) => Promise<{ fields: InvoiceExtraction; overallConfidence: number; source: string }>;

/** Loaded on first use, not at the top, so a reader that cannot start never stops receipts being stored. */
async function defaultReader(): Promise<Reader> {
  const { extractInvoice } = await import("@/server/ocr/extract").catch((error: unknown) => {
    throw Object.assign(new Error("The receipt reader could not start on this server.", { cause: error }), { name: "OcrUnavailableError" });
  });
  return extractInvoice;
}

function readerFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "OcrTimeoutError" || name === "DraftReadTimeout") return "Reading the bill took too long. Fill it in by hand, or use Read again.";
  if (name === "OcrUnavailableError") return "The receipt reader could not start on this server. Fill it in by hand. An admin can open /api/health?check=ocr to see why.";
  return "The receipt reader could not make sense of this file. Fill it in by hand.";
}

/** Runs the reader within the time left in this request; never throws. */
async function readReceipt(
  bytes: Buffer,
  mimeType: string,
  deadline: number,
  reader?: Reader,
): Promise<{ ok: true; fields: InvoiceExtraction; overall: number; source: string } | { ok: false; error: string }> {
  const left = deadline - Date.now();
  if (left < 5_000) return { ok: false, error: "There was no time left to read this bill. Use Read again, or fill it in by hand." };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = reader ?? (await defaultReader());
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Out of time"), { name: "DraftReadTimeout" })), left);
    });
    const result = await Promise.race([read(bytes, mimeType), timeout]);
    return { ok: true, fields: result.fields, overall: result.overallConfidence, source: result.source };
  } catch (error) {
    console.error("[drive-receipts] reading failed", error);
    return { ok: false, error: readerFailure(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Imports one Drive file: downloads it, stores it as a receipt, saves a draft straight away (so a
 * cut-off request still leaves a reviewable draft and no stray file), then reads it and fills the
 * draft. Files already imported are skipped; discarded ones only with `includeDiscarded`.
 */
export async function importDriveReceipt(
  input: { driveFileId: string; folderId?: string | null; includeDiscarded?: boolean; resourceKey?: string | null; folderResourceKey?: string | null },
  user: SessionUser,
  options: { reader?: Reader; startedAt?: number } = {},
): Promise<ProcessReceiptResponse> {
  const deadline = (options.startedAt ?? Date.now()) + PROCESS_BUDGET_MS;
  const driveFileId = input.driveFileId.trim();
  try {
    const previous = await ExpenseDraft.find({ driveFileId }, { status: 1, expense: 1 }).lean();
    // A saved draft whose expense was deleted since counts as discarded: it may be imported again.
    const gone = await withDeletedExpense(previous);
    const reusable = (d: (typeof previous)[number]) => d.status === "discarded" || gone.has(String(d._id));
    const open = previous.find((d) => !reusable(d));
    if (open) return { status: "skipped", reason: open.status === "saved" ? "Already saved as an expense." : "Already imported: the draft is waiting for review." };
    const discarded = previous.find(reusable);
    if (discarded && !input.includeDiscarded) {
      return { status: "skipped", reason: discarded.status === "saved" ? EXPENSE_DELETED : "Discarded before. Tick the option to import discarded files again." };
    }

    const keys: ResourceKeys = { [driveFileId]: input.resourceKey, ...(input.folderId ? { [input.folderId]: input.folderResourceKey } : {}) };
    const meta = await getDriveFile(driveFileId, keys);
    if (!isReadable(meta.mimeType)) return { status: "skipped", reason: "Only PNG, JPEG and WebP images and PDFs can be read." };
    if (meta.size !== null && meta.size > MAX_UPLOAD_BYTES) return { status: "skipped", reason: `${MB(meta.size)}, over the ${LIMIT_LABEL} limit per file.` };

    let bytes: Buffer;
    try {
      bytes = await downloadDriveFile(driveFileId, MAX_UPLOAD_BYTES, keys);
    } catch (error) {
      if (error instanceof DriveError && error.status === 413) return { status: "skipped", reason: `Over the ${LIMIT_LABEL} limit per file.` };
      throw error;
    }

    // The stored receipt keeps the Drive file id, so the saved expense's file shows where it came from.
    const stored = await storeBuffer({ bytes, name: meta.name, mimeType: meta.mimeType, kind: "receipt", userId: user.id, driveFileId });
    const fileId = String(stored._id);

    let draft: ExpenseDraftDoc;
    try {
      const fields = {
        driveFileId,
        driveFolderId: input.folderId || undefined,
        fileName: stored.name,
        mimeType: stored.mimeType,
        file: stored._id,
        status: "reading" as const,
        values: emptyValues(stored.name),
        createdBy: new Types.ObjectId(user.id),
      };
      if (discarded) {
        // Imported again: the discarded draft comes back, so the file keeps one draft.
        const reopened = await ExpenseDraft.findOneAndUpdate(
          { _id: discarded._id, status: discarded.status },
          {
            $set: fields,
            $unset: {
              ocr: 1,
              ocrError: 1,
              readAt: 1,
              expense: 1,
              savedBy: 1,
              savedAt: 1,
              discardedBy: 1,
              discardedAt: 1,
              savingSince: 1,
              savingBy: 1,
              savingKey: 1,
            },
          },
          { returnDocument: "after" },
        ).lean();
        if (!reopened) throw new AppError("This file was imported again by someone else just now.", "conflict");
        draft = reopened as ExpenseDraftDoc;
      } else {
        draft = (await ExpenseDraft.create(fields)).toObject() as ExpenseDraftDoc;
      }
      // Two tabs importing the same file at once: the earlier draft wins, the later one is undone.
      const twins = await ExpenseDraft.find({ driveFileId, status: { $in: OPEN_STATUSES } }, { _id: 1 }).sort({ _id: 1 }).lean();
      if (twins.length > 1 && String(twins[0]!._id) !== String(draft._id)) {
        await ExpenseDraft.deleteOne({ _id: draft._id, status: "reading" });
        await removeFile(fileId);
        return { status: "skipped", reason: "Already imported: someone imported it at the same moment." };
      }
    } catch (error) {
      await removeFile(fileId);
      if (error instanceof AppError) return { status: "skipped", reason: error.message };
      throw error;
    }

    const read = await readReceipt(bytes, stored.mimeType, deadline, options.reader);
    const update = read.ok ? fillFromOcr(draft.values as DraftValuesInput, read.fields, { firstRead: true }) : null;
    await ExpenseDraft.updateOne(
      { _id: draft._id, status: "reading" },
      read.ok && update
        ? {
            $set: {
              status: "ready",
              values: withoutNulls(update.values),
              ocr: { overall: read.overall, source: read.source, fields: update.confidence },
              readAt: new Date(),
              ...(update.filled === 0 ? { ocrError: "No bill details were found on this file. Fill it in by hand." } : {}),
            },
          }
        : { $set: { status: "ready", ocrError: read.ok ? null : read.error, readAt: new Date() } },
    );
    const [dto] = await loadDrafts({ ids: [String(draft._id)] });
    if (!dto) return { status: "skipped", reason: "The draft was removed while it was being read." };
    return { status: "created", draft: dto, ocrError: dto.ocrError };
  } catch (error) {
    if (error instanceof DriveError || error instanceof UploadError) {
      // A missing file, or one whose content is not what its name says, is skipped; the run goes on.
      if (error.status === 404 || (error instanceof UploadError && error.status < 500)) return { status: "skipped", reason: error.message };
      return { status: "failed", error: error.message, stop: stopsTheRun(error) };
    }
    console.error("[drive-receipts] import failed", error);
    return { status: "failed", error: "Importing this file failed on the server. Try again in a moment.", stop: false };
  }
}

/** Reads a draft's stored receipt again and fills the fields that are still empty (see fillFromOcr). */
export async function rereadDraft(draftId: string, options: { reader?: Reader; startedAt?: number } = {}): Promise<ProcessReceiptResponse> {
  const deadline = (options.startedAt ?? Date.now()) + PROCESS_BUDGET_MS;
  const draft = await ExpenseDraft.findOne({ _id: new Types.ObjectId(draftId), status: "ready" }).lean();
  if (!draft) return { status: "skipped", reason: "This draft is no longer waiting for review." };
  const file = draft.file ? await FileModel.findById(draft.file).lean() : null;
  if (!file) return { status: "skipped", reason: "The stored bill is missing, so it cannot be read again. Fill it in by hand." };
  let bytes: Buffer;
  try {
    const { readStoredFile } = await import("@/server/storage");
    bytes = await readStoredFile(file.storageKey);
  } catch (error) {
    if (error instanceof UploadError) return { status: "failed", error: error.message, stop: false };
    console.error("[drive-receipts] could not read stored file", error);
    return { status: "failed", error: "The stored bill could not be opened. Try again in a moment.", stop: false };
  }
  const read = await readReceipt(bytes, file.mimeType, deadline, options.reader);
  if (read.ok) {
    const before = cleanConfidences((draft.ocr as OcrSummary | undefined)?.fields);
    const current = storedValues(draft) as DraftValuesInput;
    // The date was never set from the bill and is still the import day: the invoice date may move it.
    const dateIsDefault = !("date" in before) && current.date === toDateInput(draft.createdAt as Date);
    const { values, confidence, filled } = fillFromOcr(current, read.fields, { firstRead: false, dateIsDefault });
    await ExpenseDraft.updateOne(
      { _id: draft._id, status: "ready" },
      filled === 0
        ? { $set: { ocrError: "Nothing new was found. Fill the remaining fields by hand.", readAt: new Date() } }
        : {
            $set: { values: withoutNulls(values), ocr: { overall: read.overall, source: read.source, fields: { ...before, ...confidence } }, readAt: new Date() },
            $unset: { ocrError: 1 },
          },
    );
  } else {
    await ExpenseDraft.updateOne({ _id: draft._id, status: "ready" }, { $set: { ocrError: read.error } });
  }
  const [dto] = await loadDrafts({ ids: [draftId] });
  if (!dto) return { status: "skipped", reason: "This draft is no longer waiting for review." };
  return { status: "reread", draft: dto, ocrError: dto.ocrError };
}

/* ---------- the review list ---------- */

type SavingMarker = Pick<ExpenseDraftDoc, "file" | "savingBy" | "savingSince" | "savingKey">;

/**
 * The expense a save made, for a save cut off half way: the one holding the draft's receipt or,
 * with `byMarker`, one the same person created from the moment the save started with the vendor,
 * amount and date being saved (a draft without a receipt).
 */
async function findSavedExpense(draft: SavingMarker, options: { byReceipt: boolean; byMarker: boolean }): Promise<Types.ObjectId | null> {
  if (options.byReceipt && draft.file) {
    const byReceipt = await Expense.findOne({ receipt: draft.file }, { _id: 1 }).lean();
    if (byReceipt) return byReceipt._id;
  }
  const key = draft.savingKey;
  if (!options.byMarker || !draft.savingBy || !draft.savingSince || !key?.vendor || !key.date || typeof key.amount !== "number") return null;
  const amount = round2(key.amount);
  const match = await Expense.findOne(
    {
      createdBy: draft.savingBy,
      createdAt: { $gte: new Date(new Date(draft.savingSince).getTime() - 5_000) },
      vendor: new RegExp(`^${escapeRegex(key.vendor.trim())}$`, "i"),
      amount: { $gte: amount - 0.005, $lte: amount + 0.005 },
      date: fromDateInput(key.date),
    },
    { _id: 1 },
  )
    .sort({ createdAt: 1 })
    .lean();
  return match?._id ?? null;
}

/** Settles drafts a stopped server left half way: reading ones open for review, saving ones are checked. */
async function settleStaleDrafts() {
  const now = Date.now();
  await ExpenseDraft.updateMany(
    { status: "reading", updatedAt: { $lt: new Date(now - STALE_READING_MS) } },
    { $set: { status: "ready", ocrError: "Reading stopped before it finished. Use Read again, or fill it in by hand." } },
  );
  const saving = await ExpenseDraft.find(
    { status: "saving", updatedAt: { $lt: new Date(now - STALE_SAVING_MS) } },
    { file: 1, savingBy: 1, savingSince: 1, savingKey: 1 },
  ).lean();
  for (const d of saving) {
    const expense = await findSavedExpense(d, { byReceipt: true, byMarker: true });
    await ExpenseDraft.updateOne(
      { _id: d._id, status: "saving" },
      expense ? { $set: { status: "saved", expense, savedBy: d.savingBy ?? undefined, savedAt: new Date() } } : { $set: { status: "ready" } },
    );
  }
}

type DupSource = {
  id: string;
  fileName: string;
  vendor: string;
  date: string | undefined;
  amount: number | undefined;
  invoiceNumber: string;
  gstin: string;
  checksum?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const sameText = (a: string | null | undefined, b: string | null | undefined) => Boolean(a?.trim() && b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase());

const dupKey = (d: Pick<DupSource, "vendor" | "date" | "amount">) =>
  d.vendor && d.date && d.amount ? `${d.vendor.trim().toLowerCase()}|${d.date}|${round2(d.amount)}` : null;

/**
 * The same supplier, for an invoice number match: the same GSTIN when both have one, otherwise the
 * same vendor name. Invoice numbers like "1" repeat across suppliers, so the number alone is not enough.
 */
function sameSupplier(a: { gstin?: string | null; vendor?: string | null }, b: { gstin?: string | null; vendor?: string | null }) {
  const ga = a.gstin?.trim().toUpperCase();
  const gb = b.gstin?.trim().toUpperCase();
  if (ga && gb) return ga === gb;
  return sameText(a.vendor, b.vendor);
}

type PurchaseMatch = {
  vendor?: string | null;
  date: Date;
  totalCost?: number | null;
  invoice?: { number?: string | null; gstin?: string | null; total?: number | null } | null;
  item?: { name?: string } | null;
};

/** Expenses, stock purchases and other drafts that look like the same bill as each target. */
async function findDuplicates(targets: DupSource[], pool: DupSource[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(targets.map((t) => [t.id, []]));
  const add = (id: string, message: string) => {
    const list = out.get(id)!;
    if (!list.includes(message)) list.push(message);
  };

  const withKey = targets.filter((t) => dupKey(t));
  const vendorRe = (t: DupSource) => new RegExp(`^${escapeRegex(t.vendor.trim())}$`, "i");
  const sameBill = withKey.length
    ? await Expense.find(
        { $or: withKey.map((t) => ({ vendor: vendorRe(t), date: fromDateInput(t.date!), amount: round2(t.amount!) })) },
        { number: 1, vendor: 1, date: 1, amount: 1 },
      )
        .limit(1000)
        .lean()
    : [];
  const byKey = new Map<string, string[]>();
  for (const e of sameBill) {
    const key = dupKey({ vendor: e.vendor, date: toDateInput(e.date as Date), amount: e.amount });
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), e.number]);
  }
  const numbers = [...new Set(targets.map((t) => t.invoiceNumber).filter(Boolean))];
  const sameInvoice = numbers.length
    ? await Expense.find({ "gst.invoiceNumber": { $in: numbers } }, { number: 1, vendor: 1, "gst.invoiceNumber": 1, "gst.gstin": 1 })
        .limit(1000)
        .lean<{ number: string; vendor?: string; gst?: { invoiceNumber?: string; gstin?: string } }[]>()
    : [];

  // Stock purchases. Ones bought before purchases were expensed have no expense of their own, and
  // are expensed when assigned to a project: saving their bill as an expense would count it twice.
  const purchaseOr = [
    ...withKey.map((t) => {
      const day = fromDateInput(t.date!);
      const amount = round2(t.amount!);
      return {
        vendor: vendorRe(t),
        date: { $gte: day, $lt: new Date(day.getTime() + DAY_MS) },
        $or: [{ totalCost: amount }, { "invoice.total": amount }],
      };
    }),
    ...(numbers.length ? [{ "invoice.number": { $in: numbers } }] : []),
  ];
  const purchases = purchaseOr.length
    ? await InventoryMovement.find({ type: "purchase", $or: purchaseOr }, { item: 1, vendor: 1, date: 1, totalCost: 1, invoice: 1 })
        .populate("item", "name")
        .limit(1000)
        .lean<PurchaseMatch[]>()
    : [];

  const checksums = [...new Set(targets.map((t) => t.checksum).filter(Boolean))] as string[];
  const sameFile = checksums.length
    ? await FileModel.find({ checksum: { $in: checksums }, "entity.type": "expense" }, { checksum: 1, entity: 1 }).limit(1000).lean()
    : [];
  const fileExpenses = sameFile.length
    ? await Expense.find({ _id: { $in: sameFile.map((f) => f.entity?.id).filter((id): id is Types.ObjectId => Boolean(id)) } }, { number: 1 }).lean()
    : [];
  const numberOf = new Map(fileExpenses.map((e) => [String(e._id), e.number]));

  for (const t of targets) {
    const key = dupKey(t);
    if (key) for (const n of byKey.get(key) ?? []) add(t.id, `Same vendor, date and amount as ${n}.`);
    if (t.invoiceNumber) {
      for (const e of sameInvoice) {
        if (e.gst?.invoiceNumber === t.invoiceNumber && sameSupplier(t, { gstin: e.gst?.gstin, vendor: e.vendor })) {
          add(t.id, `Invoice number ${t.invoiceNumber} from this supplier is already on ${e.number}.`);
        }
      }
    }
    for (const m of purchases) {
      const amount = t.amount ? round2(t.amount) : null;
      const billMatch =
        Boolean(key) &&
        sameText(m.vendor, t.vendor) &&
        toDateInput(m.date) === t.date &&
        amount !== null &&
        (round2(m.totalCost ?? 0) === amount || round2(m.invoice?.total ?? 0) === amount);
      const invoiceMatch =
        Boolean(t.invoiceNumber) && m.invoice?.number === t.invoiceNumber && sameSupplier(t, { gstin: m.invoice?.gstin, vendor: m.vendor });
      if (billMatch || invoiceMatch) {
        add(
          t.id,
          `Already recorded as a stock purchase in Inventory (${m.item?.name ?? "an item"} on ${formatDate(m.date)}). Saving it as an expense counts it twice. Discard this draft.`,
        );
      }
    }
    if (t.checksum) {
      for (const f of sameFile) {
        const n = f.checksum === t.checksum ? numberOf.get(String(f.entity?.id)) : undefined;
        if (n) add(t.id, `This exact file is already the receipt of ${n}.`);
      }
    }
    for (const other of pool) {
      if (other.id === t.id) continue;
      if (t.checksum && other.checksum === t.checksum) add(t.id, `The same file as the draft ${other.fileName}.`);
      else if (key && dupKey(other) === key) add(t.id, `Same vendor, date and amount as the draft ${other.fileName}.`);
      else if (t.invoiceNumber && other.invoiceNumber === t.invoiceNumber && sameSupplier(t, other)) {
        add(t.id, `Same invoice number and supplier as the draft ${other.fileName}.`);
      }
    }
  }
  // A stock purchase counted twice is the costliest mistake, so it comes first (the list row and
  // the save confirmation show the first warning).
  for (const [id, list] of out) out.set(id, [...list.filter((m) => m.includes("stock purchase")), ...list.filter((m) => !m.includes("stock purchase"))]);
  return out;
}

/** At most this many drafts are listed (the newest); the panel says when there are more. */
export const DRAFT_LIST_LIMIT = 1000;

/** How many drafts are waiting for review. */
export async function countOpenDrafts(): Promise<number> {
  return ExpenseDraft.countDocuments({ status: { $in: OPEN_STATUSES } });
}

/**
 * Drafts waiting for review, oldest first (the newest DRAFT_LIST_LIMIT of them), with their
 * receipts and duplicate warnings. With `ids`, only those drafts, looked up directly.
 */
export async function loadDrafts(filter: { ids?: string[] } = {}): Promise<ReceiptDraft[]> {
  if (!filter.ids) await settleStaleDrafts();
  // Duplicates are looked for among the open drafts, also when only some are returned.
  const latest = await ExpenseDraft.find({ status: { $in: OPEN_STATUSES } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(DRAFT_LIST_LIMIT)
    .populate("createdBy", "name")
    .lean();
  const wanted = filter.ids
    ? await ExpenseDraft.find({
        _id: { $in: filter.ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) },
        status: { $in: OPEN_STATUSES },
      })
        .sort({ createdAt: 1, _id: 1 })
        .populate("createdBy", "name")
        .lean()
    : [...latest].reverse();
  const all = new Map([...latest, ...wanted].map((d) => [String(d._id), d]));
  const docs = [...all.values()];
  const files = await getFiles(wanted.map((d) => d.file));
  const fileById = new Map(files.map((f) => [f.id, f]));
  const checksums = new Map(
    (await FileModel.find({ _id: { $in: docs.map((d) => d.file).filter((id): id is Types.ObjectId => Boolean(id)) } }, { checksum: 1 }).lean()).map((f) => [
      String(f._id),
      f.checksum ?? undefined,
    ]),
  );
  const sources = new Map<string, DupSource>(
    docs.map((d) => {
      const v = storedValues(d);
      const source: DupSource = {
        id: String(d._id),
        fileName: d.fileName,
        vendor: v.vendor,
        date: v.date,
        amount: v.amount,
        invoiceNumber: v.gst?.invoiceNumber ?? "",
        gstin: v.gst?.gstin ?? "",
        checksum: d.file ? checksums.get(String(d.file)) : undefined,
      };
      return [source.id, source];
    }),
  );
  const duplicates = await findDuplicates(
    wanted.map((d) => sources.get(String(d._id))!),
    [...sources.values()],
  );
  return wanted.map((d) => {
    const id = String(d._id);
    const ocr = d.ocr as OcrSummary | undefined;
    const by = d.createdBy as unknown as { name?: string } | null;
    return {
      id,
      driveFileId: d.driveFileId,
      fileName: d.fileName,
      status: d.status as ReceiptDraft["status"],
      file: d.file ? (fileById.get(String(d.file)) ?? null) : null,
      values: toFormValues(d),
      confidence: Object.fromEntries(Object.entries(cleanConfidences(ocr?.fields)).map(([k, c]) => [k.replaceAll("__", "."), c])),
      overallConfidence: typeof ocr?.overall === "number" ? ocr.overall : null,
      ocrError: d.ocrError ?? null,
      duplicates: duplicates.get(id) ?? [],
      createdAt: iso(d.createdAt as Date) ?? new Date().toISOString(),
      createdBy: by?.name ?? null,
    };
  });
}

/* ---------- editing, saving, discarding ---------- */

/** Keeps the reviewer's edits on the draft (they survive reloads). */
export async function updateDraftValues(id: string, values: DraftValuesInput): Promise<void> {
  const parsed = withoutNulls(draftValuesSchema.parse(values));
  const res = await ExpenseDraft.updateOne({ _id: new Types.ObjectId(id), status: "ready" }, { $set: { values: parsed } });
  if (!res.matchedCount) throw new AppError("This draft is no longer waiting for review. Reload the list.", "conflict");
}

/** Sets the category on the ticked drafts, so they can be saved together. */
export async function setDraftsCategory(ids: string[], category: string): Promise<{ updated: number }> {
  await assertExpenseCategoryAllowed(category);
  const res = await ExpenseDraft.updateMany(
    { _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, status: "ready" },
    { $set: { "values.category": category } },
  );
  return { updated: res.modifiedCount };
}

type CreateExpense = (input: ExpenseFormInput) => Promise<ActionResult<{ id: string; number: string }>>;

const FIELD_LABELS: Record<string, string> = {
  vendor: "Vendor",
  amount: "Amount",
  date: "Date",
  category: "Category",
  paymentMethod: "Payment method",
  projectId: "Project",
  stage: "Stage",
  gst: "GST details",
  receiptId: "Receipt",
};

/** "Amount: Must be more than zero", or the message alone when it already names the field. */
const fieldErrorText = (result: { error: string; fieldErrors?: Record<string, string[]> }) => {
  const first = Object.entries(result.fieldErrors ?? {}).find(([, m]) => m?.[0]);
  if (!first) return result.error;
  const label = FIELD_LABELS[first[0]] ?? first[0];
  const message = first[1][0]!;
  return message.toLowerCase().startsWith(label.toLowerCase()) ? message : `${label}: ${message}`;
};

/**
 * Saves one draft as an expense through the expense form's create logic (`create` is createExpense;
 * the same validation, numbering and receipt attaching). The draft is claimed first, so a double
 * click or two admins at once never create two expenses. It is kept, marked saved, afterwards.
 */
export async function saveDraft(
  id: string,
  values: DraftValuesInput | undefined,
  user: SessionUser,
  create: CreateExpense,
): Promise<{ ok: true; expenseId: string; number: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }> {
  const _id = new Types.ObjectId(id);
  if (values) await updateDraftValues(id, values);
  const savingBy = new Types.ObjectId(user.id);
  const draft = await ExpenseDraft.findOneAndUpdate(
    { _id, status: "ready" },
    { $set: { status: "saving", savingSince: new Date(), savingBy }, $unset: { savingKey: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!draft) {
    const current = await ExpenseDraft.findById(_id, { status: 1 }).lean();
    if (!current || current.status === "discarded") throw notFound("The draft");
    if (current.status === "saved") return { ok: false, error: "This draft is already saved as an expense." };
    if (current.status === "reading") return { ok: false, error: "This bill is still being read. Try again in a moment." };
    return { ok: false, error: "This draft is being saved right now." };
  }
  const release = () => ExpenseDraft.updateOne({ _id, status: "saving" }, { $set: { status: "ready" } });
  const markSaved = (expense: Types.ObjectId | string) =>
    ExpenseDraft.updateOne({ _id }, { $set: { status: "saved", expense: new Types.ObjectId(String(expense)), savedBy: savingBy, savedAt: new Date() } });
  let fileId: string | undefined;
  /**
   * After a failed create: an expense holding the claimed receipt was made after all (the receipt
   * could not be attached). The draft is marked saved and attaching is tried once more.
   */
  const recover = async (projectId: string | undefined): Promise<{ ok: true; expenseId: string; number: string } | null> => {
    if (!fileId) return null;
    const made = await findSavedExpense({ ...draft, file: new Types.ObjectId(fileId) }, { byReceipt: true, byMarker: false });
    if (!made) return null;
    await attachFiles([fileId], { type: "expense", id: String(made) }, projectId).catch((error: unknown) => console.error("[drive-receipts] attach failed", error));
    await markSaved(made);
    const number = (await Expense.findById(made, { number: 1 }).lean())?.number ?? "";
    return { ok: true, expenseId: String(made), number };
  };
  let projectId: string | undefined;
  try {
    // The stored receipt goes with the expense. It must still be free (nothing else ever uses it);
    // it is handed to whoever saves, since the expense form only attaches the saver's own uploads.
    if (draft.file) {
      const res = await FileModel.updateOne(
        { _id: draft.file, kind: "receipt", $or: [{ "entity.id": { $exists: false } }, { "entity.id": null }] },
        { $set: { uploadedBy: new Types.ObjectId(user.id) } },
      );
      if (res.matchedCount) fileId = String(draft.file);
    }
    const input = toExpenseInput(draft as ExpenseDraftDoc, fileId);
    projectId = input.projectId || undefined;
    // What is being saved, written before the expense exists, so a save cut off half way is
    // matched to its expense later (settleStaleDrafts) instead of being saved a second time.
    await ExpenseDraft.updateOne(
      { _id, status: "saving" },
      { $set: { savingKey: { vendor: input.vendor, amount: typeof input.amount === "number" ? input.amount : undefined, date: input.date } } },
    );
    // The audit trail records the expense as imported from Google Drive, with its draft.
    const result = await withAuditContext({ source: "drive", ref: { draft: id } }, () => create(input));
    if (!result.ok) {
      const made = await recover(projectId);
      if (made) return made;
      await release();
      return { ok: false, error: fieldErrorText(result), fieldErrors: result.fieldErrors };
    }
    await markSaved(result.data.id);
    return { ok: true, expenseId: result.data.id, number: result.data.number };
  } catch (error) {
    const made = await recover(projectId).catch(() => null);
    if (made) return made;
    // Still "saving" when even this fails: settleStaleDrafts matches it to its expense later.
    await release().catch(() => undefined);
    throw error;
  }
}

/** "Save all checked": each draft on its own, so one with a missing field does not stop the rest. */
export async function saveDrafts(ids: string[], user: SessionUser, create: CreateExpense): Promise<SaveDraftOutcome[]> {
  const out: SaveDraftOutcome[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const result = await saveDraft(id, undefined, user, create);
      out.push(result.ok ? { id, ok: true, expenseId: result.expenseId, number: result.number } : { id, ok: false, error: result.error });
    } catch (error) {
      out.push({ id, ok: false, error: error instanceof AppError ? error.message : "Saving failed. Try again." });
      if (!(error instanceof AppError)) console.error("[drive-receipts] save failed", error);
    }
  }
  return out;
}

/**
 * Discards a draft and deletes its stored receipt (nothing else uses it). The draft itself is kept,
 * marked discarded and without the file, so the Drive file is not imported again by mistake.
 */
export async function discardDraft(id: string, user: SessionUser): Promise<void> {
  const before = await ExpenseDraft.findOneAndUpdate(
    { _id: new Types.ObjectId(id), status: "ready" },
    { $set: { status: "discarded", discardedBy: new Types.ObjectId(user.id), discardedAt: new Date() }, $unset: { file: 1 } },
  ).lean();
  if (!before) {
    const current = await ExpenseDraft.findById(id, { status: 1 }).lean();
    if (!current || current.status === "discarded") return;
    throw new AppError(
      current.status === "saved" ? "This draft is already saved as an expense. Delete the expense instead." : "This draft is busy right now. Try again in a moment.",
      "conflict",
    );
  }
  if (!before.file) return;
  // Only a receipt no record has taken: never a file an expense or anything else points at.
  const file = await FileModel.findById(before.file, { entity: 1 }).lean();
  const used = Boolean(file?.entity?.id) || Boolean(await Expense.exists({ receipt: before.file }));
  if (file && !used) await removeFile(String(before.file));
}

/** Rethrows Drive and storage problems as messages people see as they are. */
export function asAppError(error: unknown): unknown {
  if (error instanceof DriveError || error instanceof UploadError) return new AppError(error.message, "invalid");
  return error;
}
