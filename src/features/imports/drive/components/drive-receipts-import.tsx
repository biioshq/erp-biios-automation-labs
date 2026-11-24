"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, FolderSearch, Image as ImageIcon, Info, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheet } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { useCan } from "@/components/current-user";
import { useOnLiveChange } from "@/components/live-updates";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatFileSize, formatNumber } from "@/lib/format";
import { LOW_CONFIDENCE } from "@/lib/ocr";
import { expenseCategoryChoices, expenseCategoryLabel } from "@/lib/expense-categories";
import { cn } from "@/lib/utils";
import { httpFailureMessage } from "@/features/files/upload";
import {
  discardReceiptDraftAction,
  listDriveReceiptsAction,
  loadReceiptDraftsAction,
  saveReceiptDraftsAction,
  setReceiptDraftsCategoryAction,
  updateReceiptDraftAction,
} from "../receipts/actions";
import { DraftReviewForm } from "../receipts/draft-review-form";
import type {
  DraftFormValues,
  DriveReceiptFile,
  DriveReceiptListing,
  DriveReceiptState,
  ProcessReceiptResponse,
  ReceiptDraft,
  ReceiptDraftsData,
} from "../receipts/types";

const ROUTE = "/api/imports/drive/receipts";

type FileResult = { status: "created" | "skipped" | "failed"; message: string | null };

const STATE_TEXT: Record<DriveReceiptState, string> = {
  new: "New",
  draft: "Draft waiting for review",
  saved: "Saved as an expense",
  discarded: "Discarded before",
  too_large: "Too large",
  unsupported: "Can't be read",
};

/** Setup steps, shown until GOOGLE_DRIVE_API_KEY is set. */
function SetupNote() {
  return (
    <div className="space-y-3 rounded-xl border bg-surface/40 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Info className="size-4 text-muted-foreground" /> Google Drive import is not set up yet
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
        <li>In Google Cloud Console, enable the Google Drive API for a project and create an API key (APIs and services, Credentials).</li>
        <li>
          In Vercel, add it as <span className="font-mono text-foreground">GOOGLE_DRIVE_API_KEY</span> under Settings, Environment Variables, then redeploy.
        </li>
        <li>In Google Drive, share the folder of bills as &quot;Anyone with the link&quot; (Viewer). The key can only read folders shared that way.</li>
      </ol>
    </div>
  );
}

/** Posts one file (or one draft to read again) to the import route. Never throws. */
async function postReceipt(body: Record<string, unknown>): Promise<ProcessReceiptResponse> {
  try {
    const res = await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (ProcessReceiptResponse & { error?: string }) | null;
    if (res.ok && data && "status" in data) return data;
    const error = data?.error ?? httpFailureMessage(res.status, res.headers.get("x-vercel-error"), "Import");
    // A cut-off request (timeout) only affects this file; sign-in, permission and rate limits affect every file.
    return { status: "failed", error, stop: res.status === 401 || res.status === 403 || res.status === 429 };
  } catch {
    return { status: "failed", error: "Network error. Check your connection, then continue.", stop: true };
  }
}

const lowCount = (d: ReceiptDraft) => Object.values(d.confidence).filter((c) => c < LOW_CONFIDENCE).length;

/**
 * Google Drive bills to draft expenses (needs the Finance import permission). Paste a shared folder link, see which files
 * are new, then read them one file per request (progress, Stop, continue later). Each bill becomes
 * a draft kept on the server; review it here and save it as an expense, or discard it.
 */
export function DriveReceiptsImport({ configured }: { configured: boolean }) {
  const router = useRouter();
  const canImport = useCan("finance.import:create");
  const seesSalaries = useCan("data.salaries");
  const [data, setData] = useState<ReceiptDraftsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [finding, setFinding] = useState(false);
  const [listing, setListing] = useState<DriveReceiptListing | null>(null);
  const [includeDiscarded, setIncludeDiscarded] = useState(false);
  const [results, setResults] = useState<Record<string, FileResult>>({});
  const [running, setRunning] = useState<{ done: number; total: number; name: string } | null>(null);
  const [summary, setSummary] = useState<{ created: number; skipped: number; failed: number; stopped: string | null } | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [pending, startTransition] = useTransition();
  const stopRef = useRef(false);
  const unsavedRef = useRef<(() => DraftFormValues | null) | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof loadReceiptDraftsAction>> | null) => {
    if (!result) {
      setLoadError("Could not load the drafts. Check your connection and reload the page.");
      return;
    }
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setData(result.data);
    const open = new Set(result.data.drafts.filter((d) => d.status === "ready").map((d) => d.id));
    setChecked((c) => new Set([...c].filter((id) => open.has(id))));
  }, []);
  const reload = useCallback(async () => apply(await loadReceiptDraftsAction({}).catch(() => null)), [apply]);

  useEffect(() => {
    if (!canImport) return;
    let live = true;
    loadReceiptDraftsAction({})
      .catch(() => null)
      .then((result) => live && apply(result));
    return () => {
      live = false;
    };
  }, [canImport, apply]);
  // Someone else saving or discarding drafts shows here, but never while a run or an edit is open.
  useOnLiveChange(() => {
    if (!running && !editingId) void reload();
  });

  const drafts = useMemo(() => data?.drafts ?? [], [data]);
  const editing = drafts.find((d) => d.id === editingId) ?? null;
  const categories = useMemo(() => data?.categories ?? [], [data]);
  const categoryOptions = useMemo(() => expenseCategoryChoices(categories, { allowSalaries: seesSalaries }), [categories, seesSalaries]);

  const queue: DriveReceiptFile[] = useMemo(
    () => (listing?.files ?? []).filter((f) => (f.state === "new" || (includeDiscarded && f.state === "discarded")) && results[f.id]?.status !== "created" && results[f.id]?.status !== "skipped"),
    [listing, includeDiscarded, results],
  );
  const skippedFiles = (listing?.files ?? []).filter((f) => f.state === "too_large" || f.state === "unsupported");

  if (!canImport) return <EmptyState compact title="Your role cannot import" description="Ask an admin to import the bills for you." />;

  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (!link.trim()) return;
    setFinding(true);
    try {
      const result = await listDriveReceiptsAction({ link });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setListing(result.data);
      setResults({});
      setSummary(null);
      if (result.data.files.length === 0) toast.info("No images or PDFs in that folder. Only files directly in the folder are read, not subfolders.");
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setFinding(false);
    }
  }

  async function run() {
    const files = queue;
    if (!files.length) return;
    stopRef.current = false;
    setSummary(null);
    const tally = { created: 0, skipped: 0, failed: 0, stopped: null as string | null };
    for (const [index, file] of files.entries()) {
      if (stopRef.current) {
        tally.stopped = "Stopped. Click Continue to read the rest.";
        break;
      }
      setRunning({ done: index, total: files.length, name: file.name });
      const res = await postReceipt({
        driveFileId: file.id,
        folderId: listing?.folderId ?? undefined,
        includeDiscarded,
        resourceKey: file.resourceKey ?? undefined,
        folderResourceKey: listing?.folderResourceKey ?? undefined,
      });
      let outcome: FileResult;
      if (res.status === "created" || res.status === "reread") {
        tally.created++;
        outcome = { status: "created", message: res.ocrError };
        const draft = res.draft;
        setData((d) => (d ? { ...d, drafts: [...d.drafts.filter((x) => x.id !== draft.id), draft] } : d));
      } else if (res.status === "skipped") {
        tally.skipped++;
        outcome = { status: "skipped", message: res.reason };
      } else {
        tally.failed++;
        outcome = { status: "failed", message: res.error };
      }
      setResults((r) => ({ ...r, [file.id]: outcome }));
      if (res.status === "failed" && res.stop) {
        tally.stopped = `Stopped: ${res.error}`;
        break;
      }
    }
    setRunning(null);
    setSummary(tally);
    if (tally.stopped && tally.stopped.startsWith("Stopped:")) toast.error(tally.stopped);
    // Duplicate warnings are worked out across every draft, so the list is loaded again.
    await reload();
  }

  async function reread(draftId: string): Promise<ReceiptDraft | null> {
    const res = await postReceipt({ draftId });
    if (res.status === "reread" || res.status === "created") {
      const draft = res.draft;
      setData((d) => (d ? { ...d, drafts: d.drafts.map((x) => (x.id === draft.id ? draft : x)) } : d));
      if (draft.ocrError) toast.warning(draft.ocrError);
      else toast.success("Read again. Check the highlighted fields.");
      return draft;
    }
    toast.error(res.status === "skipped" ? res.reason : res.error);
    return null;
  }

  function closeEditor() {
    // Edits made in the panel are kept on the draft, also when it is closed without a button.
    const values = unsavedRef.current?.();
    const id = editingId;
    setEditingId(null);
    if (values && id) {
      void updateReceiptDraftAction({ id, values }).then((r) => {
        if (r.ok) setData((d) => (d ? { ...d, drafts: d.drafts.map((x) => (x.id === id ? { ...x, values } : x)) } : d));
      });
    }
  }

  function removeDraft(id: string) {
    setData((d) => (d ? { ...d, drafts: d.drafts.filter((x) => x.id !== id) } : d));
    setChecked((c) => {
      const next = new Set(c);
      next.delete(id);
      return next;
    });
  }

  const readyDrafts = drafts.filter((d) => d.status === "ready");
  const checkedDrafts = readyDrafts.filter((d) => checked.has(d.id));
  const checkedWithDuplicates = checkedDrafts.filter((d) => d.duplicates.length);
  const allChecked = readyDrafts.length > 0 && checkedDrafts.length === readyDrafts.length;

  function applyCategory() {
    if (!bulkCategory || !checkedDrafts.length) return;
    startTransition(async () => {
      const ids = checkedDrafts.map((d) => d.id);
      const result = await setReceiptDraftsCategoryAction({ ids, category: bulkCategory });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Category set on ${formatNumber(result.data.updated)} draft${result.data.updated === 1 ? "" : "s"}`);
      setData((d) =>
        d ? { ...d, drafts: d.drafts.map((x) => (ids.includes(x.id) ? { ...x, values: { ...x.values, category: bulkCategory } } : x)) } : d,
      );
    });
  }

  function saveChecked() {
    const ids = checkedDrafts.map((d) => d.id);
    if (!ids.length) return;
    startTransition(async () => {
      let saved = 0;
      const errors: Record<string, string> = {};
      // A few per request, so each request stays well inside the server's time limit.
      for (let i = 0; i < ids.length; i += 10) {
        const result = await saveReceiptDraftsAction({ ids: ids.slice(i, i + 10) });
        if (!result.ok) {
          toast.error(result.error);
          break;
        }
        for (const o of result.data) {
          if (o.ok) {
            saved++;
            removeDraft(o.id);
          } else errors[o.id] = o.error;
        }
      }
      setRowErrors(errors);
      const failed = Object.keys(errors).length;
      if (saved) {
        toast.success(`Saved ${formatNumber(saved)} expense${saved === 1 ? "" : "s"}`, {
          description: failed ? `${formatNumber(failed)} need a fix first; the reason is under each.` : undefined,
        });
        emitDataChanged();
        router.refresh();
      } else if (failed) toast.error(`None were saved. ${formatNumber(failed)} need a fix first; the reason is under each.`);
      await reload();
    });
  }

  async function discard(id: string) {
    const result = await discardReceiptDraftAction({ id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Draft discarded");
    removeDraft(id);
  }

  const counts = listing?.counts;

  return (
    <div className="space-y-6">
      {!configured ? (
        <SetupNote />
      ) : (
        <div className="space-y-4">
          <form onSubmit={find} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="drive-receipts-link" className="text-[13px]">
                Google Drive folder or file link
              </Label>
              <Input
                id="drive-receipts-link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                inputMode="url"
                autoComplete="off"
                disabled={Boolean(running)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={finding || Boolean(running) || !link.trim()}>
              {finding ? <Loader2 className="animate-spin" /> : <FolderSearch />} Find bills
            </Button>
          </form>
          <p className="-mt-2 text-xs text-muted-foreground">
            Share the folder as &quot;Anyone with the link&quot;. Images (PNG, JPEG, WebP) and PDFs directly in it are read one at a time and become drafts. Files imported before are skipped.
          </p>

          {listing && counts ? (
            <div className="space-y-3 rounded-xl border bg-surface/40 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {formatNumber(listing.files.length)} file{listing.files.length === 1 ? "" : "s"}: {formatNumber(queue.length)} to read
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      counts.draft ? `${formatNumber(counts.draft)} waiting for review` : null,
                      counts.saved ? `${formatNumber(counts.saved)} already saved` : null,
                      counts.discarded ? `${formatNumber(counts.discarded)} discarded or deleted before` : null,
                      skippedFiles.length ? `${formatNumber(skippedFiles.length)} can't be imported` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "None imported before."}
                  </p>
                </div>
                {counts.discarded ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={includeDiscarded} onCheckedChange={(v) => setIncludeDiscarded(v === true)} disabled={Boolean(running)} />
                    Import discarded files again
                  </label>
                ) : null}
              </div>

              {skippedFiles.length ? (
                <div>
                  <button type="button" className="text-xs font-medium text-brand-ink underline-offset-4 hover:underline" onClick={() => setShowSkipped((s) => !s)}>
                    {showSkipped ? "Hide" : "Show"} files that can&apos;t be imported
                  </button>
                  {showSkipped ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {skippedFiles.map((f) => (
                        <li key={f.id} className="flex flex-wrap gap-x-2">
                          <span className="font-medium [overflow-wrap:anywhere]">{f.name}</span>
                          <span className="text-muted-foreground">
                            {STATE_TEXT[f.state]}. {f.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {Object.keys(results).length ? (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {listing.files
                    .filter((f) => results[f.id] && (results[f.id]!.status !== "created" || results[f.id]!.message))
                    .map((f) => {
                      const r = results[f.id]!;
                      return (
                        <li key={f.id} className="flex flex-wrap gap-x-2">
                          <span className="font-medium [overflow-wrap:anywhere]">{f.name}</span>
                          <span className={cn(r.status === "failed" ? "text-danger" : "text-muted-foreground")}>
                            {r.status === "created" ? `Draft created. ${r.message}` : r.status === "skipped" ? `Skipped. ${r.message}` : `Failed. ${r.message}`}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              ) : null}

              <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                {running ? (
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-xs text-muted-foreground">
                      Reading {formatNumber(running.done + 1)} of {formatNumber(running.total)}: {running.name}
                    </p>
                    <Progress value={Math.round((running.done / running.total) * 100)} className="h-1.5" />
                  </div>
                ) : summary ? (
                  <p className="text-sm" role="status">
                    {formatNumber(summary.created)} draft{summary.created === 1 ? "" : "s"} created, {formatNumber(summary.skipped)} skipped,{" "}
                    <span className={cn(summary.failed && "font-medium text-danger")}>{formatNumber(summary.failed)} failed</span>.
                    {summary.stopped ? ` ${summary.stopped}` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Each bill takes a few seconds. You can stop at any point and continue later.</p>
                )}
                <div className="flex gap-2">
                  {running ? (
                    <Button type="button" variant="outline" onClick={() => (stopRef.current = true)}>
                      Stop
                    </Button>
                  ) : null}
                  <Button type="button" onClick={run} disabled={Boolean(running) || queue.length === 0}>
                    {running ? <Loader2 className="animate-spin" /> : null}
                    {summary && queue.length ? "Continue" : "Read bills"}
                    {queue.length ? ` (${formatNumber(queue.length)})` : ""}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Drafts to review{data ? ` (${formatNumber(drafts.length)})` : ""}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void reload()} disabled={Boolean(running)}>
            <RefreshCw /> Reload
          </Button>
        </div>

        {data && data.total > drafts.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the newest {formatNumber(drafts.length)} of {formatNumber(data.total)} drafts. Save or discard some to see the rest.
          </p>
        ) : null}
        {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
        {!data && !loadError ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading drafts…
          </p>
        ) : null}
        {data && drafts.length === 0 ? (
          <EmptyState compact title="No drafts waiting" description="Bills read from Google Drive show here until they are saved as expenses or discarded." />
        ) : null}

        {drafts.length ? (
          <>
            <div className="flex flex-col gap-2 rounded-xl border bg-surface/40 p-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allChecked ? true : checkedDrafts.length ? "indeterminate" : false}
                  onCheckedChange={(v) => setChecked(v === true ? new Set(readyDrafts.map((d) => d.id)) : new Set())}
                  disabled={pending || readyDrafts.length === 0}
                  aria-label="Tick all drafts"
                />
                {checkedDrafts.length ? `${formatNumber(checkedDrafts.length)} ticked` : "Tick all"}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex gap-2">
                  <Select value={bulkCategory} onValueChange={setBulkCategory}>
                    <SelectTrigger className="w-full min-w-0 sm:w-52" aria-label="Category for ticked drafts">
                      <SelectValue placeholder="Category for ticked" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={applyCategory} disabled={pending || !bulkCategory || !checkedDrafts.length}>
                    Set
                  </Button>
                </div>
                <Button
                  type="button"
                  onClick={() => (checkedWithDuplicates.length ? setConfirmDuplicates(true) : saveChecked())}
                  disabled={pending || Boolean(running) || !checkedDrafts.length}
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Save ticked as expenses{checkedDrafts.length ? ` (${formatNumber(checkedDrafts.length)})` : ""}
                </Button>
              </div>
            </div>

            <ul className="divide-y rounded-xl border">
              {drafts.map((d) => {
                const low = lowCount(d);
                const isReady = d.status === "ready";
                return (
                  <li key={d.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={checked.has(d.id)}
                        disabled={!isReady || pending}
                        onCheckedChange={(v) =>
                          setChecked((c) => {
                            const next = new Set(c);
                            if (v === true) next.add(d.id);
                            else next.delete(d.id);
                            return next;
                          })
                        }
                        aria-label={`Tick ${d.fileName}`}
                      />
                      <button type="button" className="min-w-0 flex-1 space-y-1 text-left" onClick={() => setEditingId(d.id)} disabled={!isReady}>
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          {d.file?.mimeType === "application/pdf" ? (
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{d.values.vendor || "Vendor not read"}</span>
                        </p>
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {d.fileName}
                          {d.file ? ` · ${formatFileSize(d.file.size)}` : ""}
                          {d.values.date ? ` · ${formatDate(d.values.date)}` : ""}
                          {" · "}
                          {d.values.category ? expenseCategoryLabel(categories, d.values.category) : "No category yet"}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {d.status === "reading" ? <StatusBadge tone="info">Being read</StatusBadge> : null}
                          {d.status === "saving" ? <StatusBadge tone="info">Being saved</StatusBadge> : null}
                          {d.duplicates.length ? (
                            <StatusBadge tone="warning" icon={<TriangleAlert className="size-3" />}>
                              Possible duplicate
                            </StatusBadge>
                          ) : null}
                          {d.ocrError ? <StatusBadge tone="neutral">Not read automatically</StatusBadge> : null}
                          {low ? <StatusBadge tone="warning">{`${formatNumber(low)} field${low === 1 ? "" : "s"} to check`}</StatusBadge> : null}
                        </div>
                        {d.duplicates.length ? <p className="text-xs text-muted-foreground">{d.duplicates[0]}</p> : null}
                        {rowErrors[d.id] ? <p className="text-xs text-danger">{rowErrors[d.id]}</p> : null}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-7 sm:justify-end sm:pl-0">
                      {d.values.amount ? <Money value={d.values.amount} className="font-semibold" /> : <span className="text-xs text-muted-foreground">No amount</span>}
                      <div className="flex gap-1">
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(d.id)} disabled={!isReady}>
                          Review
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button type="button" variant="ghost" size="sm" className="text-danger hover:text-danger" disabled={!isReady || pending}>
                              Discard
                            </Button>
                          }
                          title="Discard this draft?"
                          description="The bill stored for it is deleted. The file stays in Google Drive and is skipped on later imports unless you tick the option to import discarded files again."
                          confirmLabel="Discard"
                          onConfirm={() => discard(d.id)}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDuplicates}
        onOpenChange={setConfirmDuplicates}
        title="Some may already be recorded"
        description={`${formatNumber(checkedWithDuplicates.length)} of the ticked drafts look like bills that are already expenses, stock purchases in Inventory or other drafts. Save them anyway?`}
        confirmLabel="Save anyway"
        destructive={false}
        onConfirm={() => {
          saveChecked();
        }}
      />

      <FormSheet
        open={Boolean(editing)}
        onOpenChange={(o) => !o && closeEditor()}
        title={editing ? editing.values.vendor || editing.fileName : "Draft"}
        description="Check the details read from the bill, then save it as an expense."
        size="xl"
      >
        {editing && data ? (
          <DraftReviewForm
            key={editing.id}
            draft={editing}
            projects={data.projects}
            categories={categories}
            unsavedRef={unsavedRef}
            onSaved={(id) => {
              unsavedRef.current = null;
              setEditingId(null);
              removeDraft(id);
              router.refresh();
              void reload();
            }}
            onDiscarded={(id) => {
              unsavedRef.current = null;
              setEditingId(null);
              removeDraft(id);
            }}
            onKept={(id, values) => {
              unsavedRef.current = null;
              setEditingId(null);
              setData((d) => (d ? { ...d, drafts: d.drafts.map((x) => (x.id === id ? { ...x, values } : x)) } : d));
              void reload();
            }}
            onReread={reread}
            onCancel={closeEditor}
          />
        ) : null}
      </FormSheet>
    </div>
  );
}
