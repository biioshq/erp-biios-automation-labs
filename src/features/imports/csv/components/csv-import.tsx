"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Download, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { PURCHASE_PAYMENT_METHODS, type PurchasePaymentMethod } from "@/features/inventory/ledger/schemas";
import { formatCurrency, formatFileSize, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { startOfMonthIST, toDateInput } from "@/lib/dates";
import { importCsvBatch, previewCsvImport } from "../actions";
import {
  CSV_FIELDS,
  DETAIL_COLUMN,
  IMPORT_BATCH,
  KIND_LABELS,
  MAX_CSV_ROWS,
  PREVIEW_CHUNK,
  fieldLabel,
  initialMapping,
  templateRows,
  type CsvImportKind,
} from "../fields";
import { parseCsv, toCsv } from "../parse";
import { newCategories, notImportedCsv, notImportedReasons, reviewRows, summarize, willImport } from "../review";
import type { CsvOptionsInput, CsvRowInput, ImportRowResult, PreviewRow } from "../schemas";
import { ColumnMapping } from "./column-mapping";
import { PreviewTable } from "./preview-table";

export type { CsvImportKind } from "../fields";

/** Larger files are refused before reading: 2,000 rows of text fit well inside this. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Excel files are read on the server, so they stay below Vercel's 4.5 MB request limit. */
const MAX_XLSX_BYTES = 4 * 1024 * 1024;

/**
 * One request stays well under Vercel's request body limit (about 4.5 MB): rows go in a chunk until
 * it reaches the row cap or this many bytes of JSON, whichever comes first.
 */
const MAX_REQUEST_BYTES = 1_500_000;
const encoder = new TextEncoder();

function chunkRows(rows: CsvRowInput[], maxRows: number): CsvRowInput[][] {
  const chunks: CsvRowInput[][] = [];
  let current: CsvRowInput[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = encoder.encode(JSON.stringify(row)).length + 1;
    if (current.length && (current.length >= maxRows || bytes + size > MAX_REQUEST_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** The item form's SKU rule: only valid SKUs are set aside for the import. */
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/;

const LIST_HREF: Record<CsvImportKind, string> = {
  expenses: "/finance/expenses",
  income: "/finance/income",
  items: "/inventory/items",
};

type LoadedFile = {
  name: string;
  size: number;
  headers: string[];
  rows: { line: number; cells: string[] }[];
  /** Excel only: the workbook's sheets and the one being imported. */
  sheets?: string[];
  sheet?: string;
};

/** The label a detail column gets on items: its header, or "Column 3" when the header is empty. */
const detailLabel = (header: string, index: number) => header.trim().replace(/\s+/g, " ") || `Column ${index + 1}`;

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Reads an Excel workbook on the server (ExcelJS) into the same shape as a parsed CSV. */
async function readExcel(f: File, kind: CsvImportKind, sheet?: string): Promise<{ headers: string[]; rows: { line: number; cells: string[] }[]; sheets: string[]; sheet: string }> {
  const form = new FormData();
  form.append("file", f);
  form.append("kind", kind);
  if (sheet) form.append("sheet", sheet);
  let res: Response;
  try {
    res = await fetch("/api/imports/excel", { method: "POST", body: form });
  } catch {
    throw new Error("Network error while reading the Excel file. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as ({ error?: string } & Partial<Awaited<ReturnType<typeof readExcel>>>) | null;
  if (!res.ok || !body?.headers || !body.rows) throw new Error(body?.error ?? `The Excel file could not be read (error ${res.status}).`);
  return body as Awaited<ReturnType<typeof readExcel>>;
}
type Filter = "all" | PreviewRow["status"];
type Run = { total: number; done: number; results: ImportRowResult[]; createdCategories: string[]; finished: boolean; stopped: boolean; error?: string };

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * CSV import for expenses, income or inventory items: pick a file, check the columns, review a dry
 * run of every row, then import the reviewed rows in batches. Admin only (the server refuses
 * others too). Nothing is saved before the admin confirms.
 */
export function CsvImport({ kinds }: { kinds: CsvImportKind[] }) {
  const [kind, setKind] = useState<CsvImportKind>(kinds[0] ?? "expenses");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [defaultPayment, setDefaultPayment] = useState<PurchasePaymentMethod>("bank_transfer");
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [createCategories, setCreateCategories] = useState(true);
  const [recordAsPurchases, setRecordAsPurchases] = useState(true);
  const [renameReusedIds, setRenameReusedIds] = useState(true);
  const [importDuplicates, setImportDuplicates] = useState(false);
  // Item rows from an earlier month would book stock purchase expenses into that month. Old stock
  // may already have been paid and recorded back then, so this needs an explicit yes.
  const [confirmEarlier, setConfirmEarlier] = useState(false);
  const [readingExcel, setReadingExcel] = useState(false);
  /** The picked file, kept to read another sheet of the same workbook. */
  const sourceRef = useRef<File | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  const labels = KIND_LABELS[kind];
  const reviewed = useMemo(
    () => (preview ? reviewRows(kind, preview, { createCategories, recordAsPurchases, renameReusedIds }) : null),
    [kind, preview, createCategories, recordAsPurchases, renameReusedIds],
  );
  /** Rows whose ID another part already has (in the file or in inventory): the tick box only shows then. */
  const reusedIds = useMemo(
    () =>
      kind === "items" && preview
        ? reviewRows(kind, preview, { createCategories: true, recordAsPurchases, renameReusedIds: true }).filter((r) => r.item?.renamedFrom).length
        : 0,
    [kind, preview, recordAsPurchases],
  );
  const monthStart = useMemo(() => toDateInput(startOfMonthIST()), []);
  const today = useMemo(() => toDateInput(new Date()), []);
  const summary = useMemo(
    () => (reviewed ? summarize(reviewed, importDuplicates, monthStart, today) : null),
    [reviewed, importDuplicates, monthStart, today],
  );
  const needsEarlierConfirm = kind === "items" && recordAsPurchases && Boolean(summary?.earlier);
  const toCreate = useMemo(() => (preview ? newCategories(preview) : []), [preview]);
  const filtered = useMemo(() => (reviewed ? (filter === "all" ? reviewed : reviewed.filter((r) => r.status === filter)) : []), [reviewed, filter]);
  const mappedKeys = mapping.filter((m): m is string => Boolean(m) && m !== DETAIL_COLUMN);
  /** Items: the headers of the columns kept as details, in file order. */
  const detailLabels = useMemo(
    () => (file && kind === "items" ? file.headers.map((h, i) => (mapping[i] === DETAIL_COLUMN ? detailLabel(h, i) : null)).filter((h): h is string => Boolean(h)) : []),
    [file, kind, mapping],
  );
  const missingRequired = CSV_FIELDS[kind].filter((f) => f.required && !mappedKeys.includes(f.key));
  const samples = useMemo(
    () => (file ? file.headers.map((_, i) => file.rows.slice(0, 20).find((r) => r.cells[i])?.cells[i] ?? "") : []),
    [file],
  );
  const running = Boolean(run && !run.finished);

  function reset(keepKind = true) {
    setFile(null);
    setFileError(null);
    setMapping([]);
    setPreview(null);
    setCheckError(null);
    setRun(null);
    setFilter("all");
    setImportDuplicates(false);
    setConfirmEarlier(false);
    setCreateCategories(true);
    setRenameReusedIds(true);
    if (!keepKind) setKind(kinds[0] ?? "expenses");
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeKind(next: CsvImportKind) {
    if (next === kind) return;
    setKind(next);
    if (file) setMapping(initialMapping(next, file.headers, file.rows.map((r) => r.cells)));
    setPreview(null);
    setCheckError(null);
    setRun(null);
    // Duplicates go in only when ticked for this kind's own review.
    setImportDuplicates(false);
  }

  async function readFile(f: File | undefined | null, sheet?: string) {
    if (!f) return;
    setFileError(null);
    setPreview(null);
    setRun(null);
    const isExcel = /\.xlsx$/i.test(f.name) || f.type === XLSX_TYPE;
    if (!isExcel && /\.(xls|xlsm|xlsb|ods|numbers)$/i.test(f.name)) {
      setFileError("This spreadsheet format cannot be read. Save it as an Excel workbook (.xlsx) or as CSV and pick that file.");
      return;
    }
    const limit = isExcel ? MAX_XLSX_BYTES : MAX_FILE_BYTES;
    if (f.size > limit) {
      setFileError(`This file is ${formatFileSize(f.size)}. Files up to ${formatFileSize(limit)} can be imported; split it into smaller files.`);
      return;
    }
    try {
      if (isExcel) setReadingExcel(true);
      const parsed = isExcel ? await readExcel(f, kind, sheet) : { ...parseCsv(await f.text()), sheets: undefined, sheet: undefined };
      sourceRef.current = f;
      if (!parsed.headers.length || parsed.headers.every((h) => !h)) {
        setFileError("This file is empty. The first line should hold the column names.");
        return;
      }
      if (!parsed.rows.length) {
        setFileError("This file has column names but no rows under them.");
        return;
      }
      if (parsed.rows.length > MAX_CSV_ROWS) {
        setFileError(`This file has ${formatNumber(parsed.rows.length)} rows. Import at most ${formatNumber(MAX_CSV_ROWS)} at a time; split it into smaller files.`);
        return;
      }
      setFile({ name: f.name, size: f.size, headers: parsed.headers, rows: parsed.rows, sheets: parsed.sheets, sheet: parsed.sheet });
      setMapping(initialMapping(kind, parsed.headers, parsed.rows.map((r) => r.cells)));
    } catch (error) {
      setFileError(
        isExcel && error instanceof Error ? error.message : "This file could not be read. Check that it is a CSV file saved as UTF-8, or an Excel workbook (.xlsx).",
      );
    } finally {
      setReadingExcel(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function rowsFor(lines?: Set<number>): CsvRowInput[] {
    if (!file) return [];
    return file.rows
      .filter((r) => !lines || lines.has(r.line))
      .map((r) => {
        const values: Record<string, string> = {};
        const extras: { label: string; value: string }[] = [];
        mapping.forEach((key, i) => {
          // Clipped to what a request takes: the field's own limit (4,000 or less) then names the problem on the row.
          const cell = r.cells[i]?.slice(0, 5000);
          if (!key || !cell) return;
          if (key === DETAIL_COLUMN) {
            if (cell.trim() && extras.length < 60) extras.push({ label: detailLabel(file.headers[i] ?? "", i).slice(0, 200), value: cell });
          } else values[key] = cell;
        });
        return kind === "items" && extras.length ? { line: r.line, values, extras } : { line: r.line, values };
      });
  }

  /** SKUs the file gives explicitly, so a suggested SKU never takes one a later row asks for. */
  function fileSkus(rows: CsvRowInput[]): string[] {
    const skus = rows.map((r) => r.values.sku?.trim().toUpperCase() ?? "").filter((s) => s.length <= 64 && SKU_PATTERN.test(s));
    return [...new Set(skus)];
  }

  /** Items: each category name in the file and how often it appears, so the server reads a misspelt one as the usual one. */
  function fileCategories(rows: CsvRowInput[]): { name: string; count: number }[] {
    const counts = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      const name = r.values.category?.trim().replace(/\s+/g, " ").slice(0, 200);
      if (!name) continue;
      const key = name.toLowerCase();
      counts.set(key, { name: counts.get(key)?.name ?? name, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    return [...counts.values()].slice(0, 2000);
  }

  function options(extra: Partial<CsvOptionsInput> = {}): CsvOptionsInput {
    return {
      defaultPaymentMethod: defaultPayment,
      recordAsPurchases,
      createCategories,
      importDuplicates,
      renameReusedIds,
      priceColumn: mappedKeys.includes("unitPrice"),
      reservedSkus: [],
      ...extra,
    };
  }

  async function check() {
    const rows = rowsFor();
    if (!rows.length) return;
    setCheckError(null);
    setPreview(null);
    setFilter("all");
    setChecking({ done: 0, total: rows.length });
    const explicit = fileSkus(rows);
    const categoryCounts = fileCategories(rows);
    const out: PreviewRow[] = [];
    let done = 0;
    try {
      for (const chunk of chunkRows(rows, PREVIEW_CHUNK)) {
        const suggested = out.filter((r) => r.item?.action === "create" && !r.item.skuGiven).map((r) => r.item!.sku);
        const result = await previewCsvImport({
          kind,
          rows: chunk,
          options: options({ reservedSkus: [...explicit, ...suggested].slice(0, 4000), fileCategories: kind === "income" ? [] : categoryCounts }),
        });
        if (!result.ok) {
          setCheckError(result.error);
          return;
        }
        out.push(...result.data.rows);
        done += chunk.length;
        setChecking({ done, total: rows.length });
      }
      setPreview(out);
    } catch {
      setCheckError(
        "The rows could not be checked. Check your connection and try again. If it keeps failing, the file may be too large to check at once: split it into smaller files.",
      );
    } finally {
      setChecking(null);
    }
  }

  async function startImport() {
    if (!reviewed || !file) return;
    const lines = new Set(reviewed.filter((r) => willImport(r, importDuplicates)).map((r) => r.line));
    // A part given a new code in the review (its ID belongs to another part) is saved with that code.
    const renamed = new Map(reviewed.filter((r) => r.item?.renamedFrom).map((r) => [r.line, r.item!.sku]));
    const rows = rowsFor(lines).map((r) => (renamed.has(r.line) ? { ...r, values: { ...r.values, sku: renamed.get(r.line)! } } : r));
    const categoryCounts = kind === "income" ? [] : fileCategories(rowsFor());
    if (!rows.length) return;
    stopRef.current = false;
    setStopping(false);
    const chunks = chunkRows(rows, IMPORT_BATCH[kind]);
    const reservedSkus = kind === "items" ? fileSkus(rowsFor()).concat([...renamed.values()]).slice(0, 4000) : [];
    let state: Run = { total: rows.length, done: 0, results: [], createdCategories: [], finished: false, stopped: false };
    setRun(state);
    for (let ci = 0; ci < chunks.length; ci++) {
      if (stopRef.current) {
        state = { ...state, stopped: true };
        break;
      }
      const chunk = chunks[ci];
      let failed: { message: string; maybeSaved: boolean } | null = null;
      try {
        const result = await importCsvBatch({ kind, rows: chunk, options: options({ reservedSkus, fileCategories: categoryCounts }) });
        if (result.ok) {
          state = {
            ...state,
            done: state.done + chunk.length,
            results: [...state.results, ...result.data.rows],
            createdCategories: [...state.createdCategories, ...result.data.createdCategories],
          };
        } else failed = { message: `Not saved: ${result.error}`, maybeSaved: false };
      } catch {
        failed = {
          message: `May already be saved: the connection dropped while saving it. Check ${kind === "items" ? "Inventory movements" : labels.title} before importing this row again.`,
          maybeSaved: true,
        };
      }
      if (failed) {
        // Not retried on its own: a stock row sent twice would add its stock twice.
        const { message } = failed;
        const inFlight = chunk.map((r) => ({ line: r.line, status: "failed" as const, message }));
        const notSent = chunks.slice(ci + 1).flat().map((r) => ({ line: r.line, status: "failed" as const, message: "Not sent: the import stopped at an error" }));
        const error = failed.maybeSaved
          ? `The import stopped at row ${chunk[0].line}. Rows ${chunk[0].line} to ${chunk[chunk.length - 1].line} may already be saved; check them before importing them again.`
          : `The import stopped at row ${chunk[0].line}: ${failed.message.replace(/^Not saved: /, "")}`;
        state = { ...state, done: state.total, results: [...state.results, ...inFlight, ...notSent], error };
        break;
      }
      setRun(state);
    }
    setRun({ ...state, finished: true });
  }

  const outcome = useMemo(() => {
    if (!run) return null;
    const imported = run.results.filter((r) => r.status === "imported");
    return {
      imported: imported.length,
      skipped: run.results.filter((r) => r.status === "skipped" && r.skipReason !== "nothing").length,
      nothing: run.results.filter((r) => r.status === "skipped" && r.skipReason === "nothing").length,
      failed: run.results.filter((r) => r.status === "failed").length,
      amount: Math.round(imported.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100,
    };
  }, [run]);

  function downloadNotImported() {
    if (!file || !reviewed || !run) return;
    const reasons = notImportedReasons(reviewed, run.results, importDuplicates, (k) => fieldLabel(kind, k));
    // Rows left unsent after Stop are not imported either.
    const handled = new Set(run.results.map((r) => r.line));
    for (const r of reviewed) if (willImport(r, importDuplicates) && !handled.has(r.line)) reasons.set(r.line, "Not imported: the import was stopped before this row");
    download(`${kind}-not-imported.csv`, notImportedCsv(file.headers, file.rows, reasons));
  }

  /* ---------- Render ---------- */

  const kindPicker =
    kinds.length > 1 ? (
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={kind}
        onValueChange={(v) => v && changeKind(v as CsvImportKind)}
        disabled={running || Boolean(checking)}
        aria-label="What the file holds"
      >
        {kinds.map((k) => (
          <ToggleGroupItem key={k} value={k} className="h-10 px-4 text-sm sm:h-8">
            {KIND_LABELS[k].title}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    ) : null;

  // Step 4: the result.
  if (run && run.finished && outcome) {
    const notImported = (reviewed?.length ?? 0) - outcome.imported;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border bg-surface/40 p-4">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full border", outcome.imported ? "border-success/30 bg-success/10" : "bg-muted")}>
            <CircleCheck className={cn("size-5", outcome.imported ? "text-success" : "text-muted-foreground")} />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {outcome.imported ? `${plural(outcome.imported, labels.one, labels.many)} imported` : `No ${labels.many} were imported`}
              {run.stopped ? " before you stopped the import" : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              {kind === "items"
                ? outcome.amount
                  ? `Stock purchases added ${formatCurrency(outcome.amount)} of expenses.`
                  : "No expenses were added."
                : `Total ${formatCurrency(outcome.amount)}.`}
              {outcome.skipped ? ` ${plural(outcome.skipped, "row was", "rows were")} skipped as already recorded.` : ""}
              {outcome.nothing ? ` ${plural(outcome.nothing, "row was", "rows were")} skipped with no stock to add.` : ""}
              {outcome.failed ? ` ${plural(outcome.failed, "row needs", "rows need")} a look (listed below).` : ""}
              {run.createdCategories.length ? ` New categories: ${run.createdCategories.join(", ")}.` : ""}
            </p>
            {run.error ? <p className="text-sm text-danger">{run.error}</p> : null}
          </div>
        </div>

        {run.results.some((r) => r.status !== "imported") ? (
          <div className="max-h-72 overflow-auto rounded-lg border">
            <ul className="divide-y text-sm">
              {run.results
                .filter((r) => r.status !== "imported")
                .map((r) => (
                  <li key={r.line} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">Row {r.line}</span>
                    <StatusBadge tone={r.status === "failed" ? "danger" : "warning"}>
                      {r.status === "skipped" ? "Skipped" : r.message.startsWith("May already") ? "Check" : "Not saved"}
                    </StatusBadge>
                    <span className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">{r.message}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={LIST_HREF[kind]}>View {labels.many}</Link>
          </Button>
          {notImported > 0 ? (
            <Button type="button" variant="outline" onClick={downloadNotImported}>
              <Download />
              Rows not imported ({formatNumber(notImported)})
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => reset()}>
            <RotateCcw />
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  // Step 3b: saving.
  if (run && !run.finished) {
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    return (
      <div className="space-y-4" aria-live="polite">
        <div className="space-y-2 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Spinner />
              Importing {labels.many}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatNumber(run.done)} of {formatNumber(run.total)}
            </span>
          </div>
          <Progress value={pct} aria-label="Import progress" />
          <p className="text-xs text-muted-foreground">Keep this page open until it finishes. Each row is saved on its own, so one bad row does not stop the rest.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={stopping}
          onClick={() => {
            stopRef.current = true;
            setStopping(true);
          }}
        >
          {stopping ? "Stopping after this batch…" : "Stop after this batch"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Step 1: kind, template and file. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {kindPicker ?? <span />}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={`/api/imports/excel?kind=${kind}`} download>
              <Download />
              {kinds.length > 1 ? `${labels.title} template (Excel)` : "Template (Excel)"}
            </a>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => download(`${kind}-template.csv`, toCsv(templateRows(kind)))}>
            CSV template
          </Button>
        </div>
      </div>

      {!file ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void readFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface/40 px-6 py-10 text-center transition-colors hover:border-brand/50 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              dragging && "border-brand bg-brand/10",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full border bg-card shadow-card transition-transform group-hover:-translate-y-0.5">
              <Upload className="size-4.5 text-muted-foreground group-hover:text-brand-ink" />
            </span>
            <span className="text-sm font-medium">{readingExcel ? "Reading the Excel file…" : "Choose a CSV or Excel file, or drop it here"}</span>
            <span className="max-w-md text-xs text-muted-foreground">
              Up to {formatNumber(MAX_CSV_ROWS)} {labels.many}. Needs {CSV_FIELDS[kind].filter((f) => f.required).map((f) => f.label.toLowerCase()).join(", ")}
              {kind === "items" ? "; quantity and unit price add stock" : ""}.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={`.csv,.xlsx,text/csv,text/plain,${XLSX_TYPE}`}
            className="hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          {fileError ? <p className="text-sm text-danger" role="alert">{fileError}</p> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
            <FileSpreadsheet className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {plural(file.rows.length, "row", "rows")} · {plural(file.headers.length, "column", "columns")} · {formatFileSize(file.size)}
            </p>
          </div>
          {file.sheets && file.sheets.length > 1 ? (
            <Select value={file.sheet} onValueChange={(s) => void readFile(sourceRef.current, s)} disabled={Boolean(checking) || readingExcel}>
              <SelectTrigger size="sm" className="w-auto max-w-56" aria-label="Sheet to import">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {file.sheets.map((s) => (
                  <SelectItem key={s} value={s}>
                    Sheet: {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => reset()} disabled={Boolean(checking)}>
            Choose another file
          </Button>
          {/* A failed sheet switch keeps the current sheet; say why. */}
          {fileError ? (
            <p className="w-full text-sm text-danger" role="alert">
              {fileError}
            </p>
          ) : null}
        </div>
      )}

      {/* Step 2: columns and defaults. */}
      {file && !preview ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Columns</h3>
            <p className="text-xs text-muted-foreground">Matched from the column names. Change any that are wrong; columns set to Do not import are left out.</p>
          </div>
          <ColumnMapping kind={kind} headers={file.headers} samples={samples} mapping={mapping} onChange={setMapping} disabled={Boolean(checking)} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="csv-default-payment">When a row has no payment method</Label>
              <Select value={defaultPayment} onValueChange={(v) => setDefaultPayment(v as PurchasePaymentMethod)} disabled={Boolean(checking)}>
                <SelectTrigger id="csv-default-payment" className="w-full max-md:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PURCHASE_PAYMENT_METHODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Rows that use it are marked Default in the preview.</p>
            </div>
          </div>

          {checkError ? <p className="text-sm text-danger" role="alert">{checkError}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void check()} disabled={Boolean(checking) || readingExcel || missingRequired.length > 0}>
              {checking ? <Spinner /> : null}
              {checking ? `Checking ${formatNumber(checking.done)} of ${formatNumber(checking.total)}…` : `Check ${plural(file.rows.length, "row", "rows")}`}
            </Button>
            <span className="text-xs text-muted-foreground">Nothing is saved yet. Every row is checked first.</span>
          </div>
        </div>
      ) : null}

      {/* Step 3: review. */}
      {file && reviewed && summary ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Review</h3>
              <p className="text-xs text-muted-foreground">Only rows marked Ready are imported. Fix the others in the file and import them later.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)}>
              <ArrowLeft />
              Columns
            </Button>
          </div>

          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={filter}
            onValueChange={(v) => v && setFilter(v as Filter)}
            aria-label="Show rows"
            className="flex-wrap"
          >
            <FilterItem value="all" label="All" count={reviewed.length} />
            <FilterItem value="ready" label="Ready" count={summary.ready} />
            <FilterItem value="error" label="Need a fix" count={summary.error} />
            <FilterItem value="duplicate" label="Duplicates" count={summary.duplicate} />
            {kind === "items" ? <FilterItem value="skip" label="Nothing to add" count={summary.skip} /> : null}
          </ToggleGroup>

          <PreviewTable
            key={filter}
            kind={kind}
            rows={filtered}
            mappedKeys={mappedKeys}
            detailLabels={detailLabels}
            importDuplicates={importDuplicates}
          />

          <div className="space-y-3 rounded-lg border bg-surface/40 p-3">
            {toCreate.length ? (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={createCategories} onCheckedChange={(c) => setCreateCategories(c === true)} className="mt-0.5" />
                <span>
                  <span className="font-medium">
                    Create the {plural(toCreate.length, "new category", "new categories")} from the file
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {toCreate.join(", ")}. {kind === "items" ? "Added to inventory categories" : "Added to expense categories"} when you import; you can
                    rename or remove them later on the Categories page.
                  </span>
                </span>
              </label>
            ) : null}
            {kind === "items" ? (
              <>
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={recordAsPurchases} onCheckedChange={setRecordAsPurchases} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Record the stock of new items as purchases (adds expenses)</span>
                    <span className="block text-xs text-muted-foreground">
                      Off: their stock is counted as already on hand, with no expense. Rows that add stock to an existing item are always purchases.
                    </span>
                  </span>
                </label>
                {reusedIds ? (
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox checked={renameReusedIds} onCheckedChange={(c) => setRenameReusedIds(c === true)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Give reused IDs a new code ({formatNumber(reusedIds)})</span>
                      <span className="block text-xs text-muted-foreground">
                        These parts have an ID that another part already has. The first part keeps it; each later one is saved with the new code shown
                        in its SKU column. Off: they are left out until the file gives each part its own ID.
                      </span>
                    </span>
                  </label>
                ) : null}
                {summary.duplicate ? (
                  <label className="flex items-start gap-3 text-sm">
                    <Checkbox checked={importDuplicates} onCheckedChange={(c) => setImportDuplicates(c === true)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Import duplicates anyway ({formatNumber(summary.duplicate)})</span>
                      <span className="block text-xs text-muted-foreground">
                        Only when they really are separate purchases, such as two equal deliveries on one day. Each adds its stock and its expense.
                      </span>
                    </span>
                  </label>
                ) : null}
              </>
            ) : summary.duplicate ? (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox checked={importDuplicates} onCheckedChange={(c) => setImportDuplicates(c === true)} className="mt-0.5" />
                <span>
                  <span className="font-medium">Import duplicates anyway ({formatNumber(summary.duplicate)})</span>
                  <span className="block text-xs text-muted-foreground">Only when they really are separate {labels.many}, such as two equal bills on one day.</span>
                </span>
              </label>
            ) : null}
            <p className="text-sm">
              {summary.ready + (importDuplicates ? summary.duplicate : 0) === 0
                ? "No rows are ready to import."
                : kind === "items"
                  ? `${plural(summary.creates, "new item", "new items")} and ${plural(summary.purchases, "stock purchase", "stock purchases")}${
                      summary.updates ? `; ${plural(summary.updates, "item gets", "items get")} details it lacked` : ""
                    }. ${summary.amount ? `This adds ${formatCurrency(summary.amount)} of expenses.` : "This adds no expenses."}`
                  : `${plural(summary.ready + (importDuplicates ? summary.duplicate : 0), labels.one, labels.many)} totalling ${formatCurrency(summary.amount)}.`}
            </p>
            {summary.earlier ? (
              <p className="text-xs text-muted-foreground">
                {plural(summary.earlier, "row is", "rows are")} dated before this month, so {summary.earlier === 1 ? "its amount counts" : "their amounts count"} in
                those months&apos; totals.
              </p>
            ) : null}
            {needsEarlierConfirm ? (
              <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs">
                <Checkbox checked={confirmEarlier} onCheckedChange={(v) => setConfirmEarlier(v === true)} className="mt-0.5" />
                <span>
                  Book these older purchases as expenses in their months. Leave this off for stock that was already paid and recorded as an
                  expense back then, and turn off &quot;Record the stock as purchases&quot; above instead.
                </span>
              </label>
            ) : null}
            {summary.later ? (
              <p className="text-xs text-muted-foreground">
                {plural(summary.later, "row is", "rows are")} dated after today. Check the year before importing; rows more than a month ahead are
                marked in the preview.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              destructive={false}
              title={`Import ${plural(summary.ready + (importDuplicates ? summary.duplicate : 0), labels.one, labels.many)}?`}
              description={
                kind === "items"
                  ? `${plural(summary.creates, "new item", "new items")} and ${plural(summary.purchases, "stock purchase", "stock purchases")} are saved now${
                      summary.amount ? `, adding ${formatCurrency(summary.amount)} of expenses` : ""
                    }. Rows that need a fix${importDuplicates ? "" : " and duplicates"} are left out.`
                  : `They are added to the books now, totalling ${formatCurrency(summary.amount)}. Rows that need a fix${importDuplicates ? "" : " and duplicates"} are left out.`
              }
              confirmLabel="Import"
              onConfirm={() => {
                setConfirmOpen(false);
                void startImport();
              }}
            />
            <Button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={summary.ready + (importDuplicates ? summary.duplicate : 0) === 0 || (needsEarlierConfirm && !confirmEarlier)}
            >
              <Upload />
              Import {plural(summary.ready + (importDuplicates ? summary.duplicate : 0), labels.one, labels.many)}
            </Button>
            {summary.error ? (
              <span className="text-xs text-muted-foreground">
                {plural(summary.error, "row needs", "rows need")} a fix and will be left out.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterItem({ value, label, count }: { value: Filter; label: string; count: number }) {
  return (
    <ToggleGroupItem value={value} className="h-10 gap-1.5 px-3 text-xs sm:h-8" aria-label={`${label}: ${count}`}>
      {label}
      <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{formatNumber(count)}</span>
    </ToggleGroupItem>
  );
}
