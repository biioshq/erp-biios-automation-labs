"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, FileText, Landmark, Lock, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatFileSize, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankAccountOption } from "@/server/lookups";
import { INCOME_CATEGORIES, labelOf, type BankLineAction } from "@/lib/constants";
import { addStatementBatch, reviewStatement } from "../actions";
import { ADD_BATCH } from "../schemas";
import { amountLayout, autoMapping, mappingProblems } from "../parse/columns";
import { buildStatement } from "../parse/statement";
import type { AddLineResult, ColumnRole, LineDecision, ParsedStatement, ReadStatementResult, ReviewLine, StatementPickers } from "../types";
import {
  DESTINATION_LABELS,
  REVIEW_FILTERS,
  actionFits,
  amountOf,
  decisionProblem,
  destinationOf,
  destinationTotals,
  inFilter,
  isWithdrawal,
  notAddedCsv,
  toWire,
  wireDecision,
  withAction,
  type ReviewFilter,
} from "../review-state";
import { MappingPanel } from "./mapping-panel";
import { StatementOverview } from "./statement-overview";
import { ReviewTable, type TableRowState } from "./review-table";
import { LineEditor } from "./line-editor";
import { BulkBar, type BulkChange } from "./bulk-bar";
import { AddResult, type AssetCandidate, type NotAdded } from "./add-result";
import { StatementPreview } from "./statement-preview";

/** Like the Excel import: below Vercel's 4.5 MB request limit. */
const MAX_BYTES = 4 * 1024 * 1024;
const PAGE_SIZE = 50;
/** Lines shown under the columns before the review, to check they are read right. */
const PREVIEW_ROWS = 10;
const ACCEPT = ".csv,.txt,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

type Review = { accountId: string; statement: ParsedStatement; lines: ReviewLine[]; pickers: StatementPickers };
type Run = { pending: number[]; total: number; results: AddLineResult[]; statementId: string | null; busy: boolean; error: string | null };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** The category a new expense or income goes under, in words. */
function categoryLabel(r: TableRowState, pickers: StatementPickers | null): string | null {
  const d = r.decision;
  if (d.action === "expense") return (d.category && pickers?.categories.find((c) => c.value === d.category)?.label) || d.category || null;
  if (d.action === "income") return d.incomeCategory ? labelOf(INCOME_CATEGORIES, d.incomeCategory) : null;
  return null;
}

/** Where one line goes, in a few words: "New income under Other". */
function checkLabel(r: TableRowState, pickers: StatementPickers | null): string {
  const where = DESTINATION_LABELS[destinationOf(r.line, r.decision)];
  const category = categoryLabel(r, pickers);
  return category ? `${where} under ${category}` : where;
}

/** Lines grouped by where they go and under which category, for the confirm. */
function checkGroups(rows: TableRowState[], pickers: StatementPickers | null): { label: string; count: number; amount: number }[] {
  const by = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    const k = checkLabel(r, pickers);
    const cur = by.get(k) ?? { count: 0, amount: 0 };
    by.set(k, { count: cur.count + 1, amount: cur.amount + amountOf(r.line) });
  }
  return [...by.entries()].map(([label, v]) => ({ label, count: v.count, amount: Math.round(v.amount * 100) / 100 })).sort((a, b) => b.count - a.count);
}

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

/** The longest password the server takes (MAX_PDF_PASSWORD in server/pdf.ts). */
const MAX_PASSWORD = 128;

/** A locked PDF: the server needs its password ("missing") or the one typed did not open it ("wrong"). */
class PasswordNeeded extends Error {
  constructor(
    message: string,
    readonly reason: "missing" | "wrong",
  ) {
    super(message);
  }
}

/** The password goes in the POST body only, never in the address or anywhere it is kept. */
async function readOnServer(file: File, password?: string): Promise<ReadStatementResult> {
  const form = new FormData();
  form.append("file", file);
  if (password) form.append("password", password);
  let res: Response;
  try {
    res = await fetch("/api/bank-statements", { method: "POST", body: form });
  } catch {
    throw new Error("Network error while reading the statement. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (Partial<ReadStatementResult> & { error?: string; needsPassword?: "missing" | "wrong" }) | null;
  if (body?.needsPassword === "missing" || body?.needsPassword === "wrong") {
    throw new PasswordNeeded(body.error ?? "This PDF is password protected.", body.needsPassword);
  }
  if (!res.ok || !body?.grid) throw new Error(body?.error ?? `The statement could not be read (error ${res.status}).`);
  return body as ReadStatementResult;
}

/**
 * Bank statement upload: pick the account and the file, check the columns, review every line
 * against the books, then add the ticked lines. Nothing is saved before Add, and adding is safe to
 * repeat: a line already added is reported, never added twice.
 */
export function StatementImport({ accounts }: { accounts: BankAccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(() => (accounts.find((a) => a.kind === "bank") ?? accounts[0])?.value ?? "");
  const [file, setFile] = useState<(ReadStatementResult & { size: number }) | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [headerIndex, setHeaderIndex] = useState(-1);
  const [mapping, setMapping] = useState<(ColumnRole | null)[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<LineDecision[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  // Money out and money in are paged on their own.
  const [pageBySide, setPageBySide] = useState<{ out: number; in: number }>({ out: 0, in: 0 });
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [dragging, setDragging] = useState(false);
  // A locked PDF waiting for its password. The password lives only here, until the file is read or changed.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const problemsOfMapping = headerIndex >= 0 ? mappingProblems(mapping) : ["no header"];
  const layout = headerIndex >= 0 ? amountLayout(mapping) : null;
  // Before the review the columns are always open for a check; after it, on request.
  const mappingOpen = !review || showMapping;
  const parsed = useMemo(
    () => (file && headerIndex >= 0 && mappingProblems(mapping).length === 0 ? buildStatement(file.grid, headerIndex, mapping) : null),
    [file, headerIndex, mapping],
  );
  const ctx = useMemo(() => (review ? { accountId: review.accountId, pickers: review.pickers } : null), [review]);
  const problems = useMemo(
    () => (review && ctx ? review.lines.map((l, i) => (decisions[i] ? decisionProblem(l, decisions[i]!, ctx) : "Not reviewed")) : []),
    [review, ctx, decisions],
  );
  const rows: TableRowState[] = useMemo(
    () => (review ? review.lines.map((line, index) => ({ index, line, decision: decisions[index]!, problem: problems[index] ?? null, selected: Boolean(selected[index]) })) : []),
    [review, decisions, problems, selected],
  );
  const counts = useMemo(
    () => Object.fromEntries(REVIEW_FILTERS.map((f) => [f.value, rows.filter((r) => inFilter(f.value, r.line, r.decision, r.problem)).length])) as Record<ReviewFilter, number>,
    [rows],
  );
  const visible = useMemo(() => rows.filter((r) => inFilter(filter, r.line, r.decision, r.problem)), [rows, filter]);
  const ticked = rows.filter((r) => r.selected && !r.line.imported);
  const ready = ticked.filter((r) => r.problem === null);
  const blocked = ticked.length - ready.length;
  const finished = Boolean(run && !run.busy && run.pending.length === 0);

  function resetReview() {
    setReview(null);
    setReviewError(null);
    setDecisions([]);
    setSelected([]);
    setFilter("all");
    setPageBySide({ out: 0, in: 0 });
    setEditing(null);
    setRun(null);
  }

  function resetAll() {
    resetReview();
    setFile(null);
    setFileError(null);
    setHeaderIndex(-1);
    setMapping([]);
    setShowMapping(false);
    setLocked(null);
    setPassword("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function runReview(statement: ParsedStatement, forAccount: string) {
    resetReview();
    if (!forAccount) return;
    if (!statement.lines.length) {
      setReviewError("No transactions were found under the column names. Check the row with the column names and what each column holds.");
      setShowMapping(true);
      return;
    }
    setReviewing(true);
    try {
      const result = await reviewStatement({ accountId: forAccount, lines: statement.lines.map(toWire) });
      if (!result.ok) {
        setReviewError(result.error);
        return;
      }
      const { lines, pickers } = result.data;
      const next = { accountId: forAccount, statement, lines, pickers };
      const ds = lines.map((l) => l.suggestion);
      setReview(next);
      setDecisions(ds);
      // Every line that can be added starts ticked, so one Add books the whole statement as shown. Lines
      // that may already be in the books (holdBack) or still miss details start unticked.
      setSelected(lines.map((l, i) => !l.imported && !l.holdBack && decisionProblem(l, ds[i]!, { accountId: forAccount, pickers }) === null));
    } catch {
      setReviewError("The lines could not be checked against the books. Check your connection and try again.");
    } finally {
      setReviewing(false);
    }
  }

  async function pickFile(f: File | null | undefined) {
    if (!f) return;
    resetAll();
    if (f.size > MAX_BYTES) {
      setFileError(`This file is ${formatFileSize(f.size)}. Statements up to 4 MB can be uploaded: download a shorter period, or the CSV version.`);
      return;
    }
    await readFile(f);
  }

  async function readFile(f: File, pdfPassword?: string) {
    setReading(true);
    setFileError(null);
    try {
      const read = await readOnServer(f, pdfPassword);
      setLocked(null);
      setPassword("");
      setFile({ ...read, size: f.size });
      setHeaderIndex(read.headerIndex);
      setMapping(read.mapping);
      // The columns are always shown for a check first; the review starts with Continue to review.
      setShowMapping(true);
    } catch (error) {
      if (error instanceof PasswordNeeded) {
        setLocked(f);
        if (error.reason === "wrong") setPassword("");
      }
      setFileError(error instanceof Error ? error.message : "This statement could not be read.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function changeHeader(index: number) {
    if (!file) return;
    setHeaderIndex(index);
    setMapping(autoMapping(file.grid[index]?.cells ?? []));
    resetReview();
  }

  function changeMapping(next: (ColumnRole | null)[]) {
    setMapping(next);
    resetReview();
  }

  function changeAccount(next: string) {
    setAccountId(next);
    // Matches and suggestions belong to one account: check the lines again for the new one.
    if (parsed && review) void runReview(parsed, next);
  }

  function setDecision(index: number, d: LineDecision) {
    setDecisions((all) => all.map((x, i) => (i === index ? d : x)));
  }

  function setAction(index: number, action: BankLineAction) {
    const line = review?.lines[index];
    if (!line) return;
    setDecision(index, withAction(line, decisions[index]!, action));
    // Choosing what a line is counts as reviewing it.
    setSelected((all) => all.map((x, i) => (i === index ? true : x)));
  }

  function toggle(indices: number[], on: boolean) {
    const set = new Set(indices);
    setSelected((all) => all.map((x, i) => (set.has(i) && !review?.lines[i]?.imported ? on : x)));
  }

  function applyBulk(change: BulkChange) {
    if (!review) return;
    let changed = 0;
    let skipped = 0;
    const next = decisions.map((d, i) => {
      const line = review.lines[i]!;
      if (!selected[i] || line.imported) return d;
      if (change.kind === "action") {
        if (!actionFits(line, change.action)) {
          skipped++;
          return d;
        }
        changed++;
        return withAction(line, d, change.action);
      }
      if (change.kind === "category") {
        if (d.action !== "expense") {
          skipped++;
          return d;
        }
        changed++;
        return { ...d, category: change.category };
      }
      if (d.action !== "expense" && d.action !== "income") {
        skipped++;
        return d;
      }
      changed++;
      return { ...d, projectId: change.projectId, stage: d.action === "expense" ? change.stage : undefined };
    });
    setDecisions(next);
    const what = change.kind === "category" ? "they are not new expenses" : change.kind === "project" ? "they are not new expenses or income" : "it does not fit their side or they have no match";
    if (skipped) toast.info(`Changed ${plural(changed, "line", "lines")}. ${plural(skipped, "line was", "lines were")} left as ${skipped === 1 ? "it was" : "they were"}: ${what}.`);
    else toast.success(`Changed ${plural(changed, "line", "lines")}.`);
  }

  async function addLines(indices: number[], current: Run | null) {
    if (!review || !file) return;
    const s = review.statement;
    const header = { fileName: file.fileName.slice(0, 260), from: s.from, to: s.to, opening: s.opening, closing: s.closing, lines: s.lines.length };
    let state: Run = current
      ? { ...current, busy: true, error: null }
      : { pending: indices, total: indices.length, results: [], statementId: null, busy: true, error: null };
    setRun(state);
    let pending = [...indices];
    while (pending.length) {
      const chunk = pending.slice(0, ADD_BATCH);
      try {
        const res = await addStatementBatch({
          accountId: review.accountId,
          statementId: state.statementId,
          statement: header,
          lines: chunk.map((i) => {
            const line = review.lines[i]!;
            return { ...toWire(line), occurrence: line.occurrence, decision: wireDecision(decisions[i]!) };
          }),
        });
        if (!res.ok) {
          state = { ...state, pending, busy: false, error: res.error };
          break;
        }
        pending = pending.slice(chunk.length);
        state = { ...state, pending, results: [...state.results, ...res.data.results], statementId: res.data.statementId ?? state.statementId };
        setRun(state);
      } catch {
        state = {
          ...state,
          pending,
          busy: false,
          error: "The connection dropped while adding lines. Adding again is safe: lines that were saved are recognised and not added twice.",
        };
        break;
      }
    }
    state = { ...state, busy: false };
    setRun(state);
    router.refresh();
  }

  const notAdded: NotAdded[] = useMemo(() => {
    if (!review || !run) return [];
    const byHash = new Map(run.results.map((r) => [r.hash, r]));
    const pendingSet = new Set(run.pending);
    const out: NotAdded[] = [];
    review.lines.forEach((line, i) => {
      const r = byHash.get(line.hash);
      if (r && (r.status === "added" || r.status === "matched" || r.status === "ignored")) return;
      const reason = line.imported
        ? "Imported from an earlier statement"
        : r
          ? r.message
          : pendingSet.has(i)
            ? "Not sent: adding stopped before this line"
            : !selected[i]
              ? line.holdBack
                ? `Not ticked: ${line.holdBack}`
                : "Not ticked"
              : (problems[i] ?? "Not added");
      out.push({ line, reason });
    });
    return out;
  }, [review, run, selected, problems]);

  // Lines that pay an unpaid bill: the bill is marked paid with the statement's date, no expense is made.
  const billSummary = useMemo(
    () =>
      rows.reduce(
        (t, r) => (!r.line.imported && r.decision.action === "match" && r.decision.matchKey?.startsWith("bill:") ? { count: t.count + 1, amount: t.amount + amountOf(r.line), ticked: t.ticked + (r.selected ? 1 : 0) } : t),
        { count: 0, amount: 0, ticked: 0 },
      ),
    [rows],
  );

  // New equipment expenses, offered for the asset register on the results screen.
  const assets: AssetCandidate[] = useMemo(() => {
    if (!review || !run) return [];
    const index = new Map(review.lines.map((l, i) => [l.hash, i]));
    return run.results.flatMap((r) => {
      const i = index.get(r.hash);
      const d = i === undefined ? undefined : decisions[i];
      return r.status === "added" && r.recordKind === "expense" && r.recordId && d?.action === "expense" && d.category === "equipment"
        ? [{ id: r.recordId, label: r.label ?? "Expense", line: r.line }]
        : [];
    });
  }, [review, run, decisions]);

  if (!accounts.length) {
    return <EmptyState title="No bank account is set up" description="Add the account on Cash & bank first." />;
  }

  if (finished && run && review) {
    return (
      <AddResult
        results={run.results}
        notAdded={notAdded}
        assets={assets}
        statementId={run.statementId}
        onDownload={() => download(`${file?.fileName.replace(/\.[^.]+$/, "") ?? "statement"}-not-added.csv`, notAddedCsv(notAdded))}
        onReset={resetAll}
      />
    );
  }

  const editingLine = editing !== null && review ? review.lines[editing]! : null;
  const busy = reading || reviewing || Boolean(run?.busy);
  // What Add sends: the ticked lines that have every detail they need.
  const readySides = ready.reduce((s, r) => (isWithdrawal(r.line) ? { ...s, out: s.out + amountOf(r.line) } : { ...s, in: s.in + amountOf(r.line) }), { out: 0, in: 0 });
  // Lines that may already be in the books stay unticked until a person ticks them.
  const held = rows.filter((r) => !r.selected && !r.line.imported && r.line.holdBack);
  const leftOut = rows.filter((r) => !r.selected && !r.line.imported && !r.line.holdBack).length;
  // Ticked lines no earlier record or rule recognised: added with the default shown, to check afterwards.
  const defaulted = checkGroups(ready.filter((r) => r.line.attention && !r.line.group), review?.pickers ?? null);
  const groupRows = ready.filter((r) => r.line.group);
  // Unticked lines that need a choice, apart from the ones held back above.
  const waitingTotal = rows.filter((r) => !r.selected && !r.line.imported && !r.line.holdBack && (r.line.attention || r.problem !== null)).length;
  const totals = ready.reduce(
    (t, r) => {
      const a = amountOf(r.line);
      if (r.decision.action === "expense") t.expense += a;
      else if (r.decision.action === "income") t.income += a;
      if (r.decision.action === "match") t.matched++;
      else if (r.decision.action === "ignore") t.ignored++;
      else t.created++;
      return t;
    },
    { expense: 0, income: 0, created: 0, matched: 0, ignored: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-0 flex-1 basis-64 gap-1.5 sm:max-w-sm">
          <Label htmlFor="statement-account">Account this statement is for</Label>
          <Select value={accountId} onValueChange={changeAccount} disabled={busy}>
            <SelectTrigger id="statement-account" className="w-full">
              <SelectValue placeholder="Pick the account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                  {a.description ? <span className="text-muted-foreground"> · {a.description}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {file ? (
          <div className="flex min-w-0 flex-1 basis-64 items-center gap-3 rounded-lg border px-3 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
              <FileText className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.fileName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[file.format.toUpperCase(), file.bank, file.sheet ? `Sheet ${file.sheet}` : null, formatFileSize(file.size)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={resetAll} disabled={busy}>
              Change file
            </Button>
          </div>
        ) : null}
      </div>

      {!file ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={reading || !accountId}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void pickFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface/40 px-6 py-10 text-center transition-colors hover:border-brand/50 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
              dragging && "border-brand bg-brand/10",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full border bg-card shadow-card transition-transform group-hover:-translate-y-0.5">
              {reading ? <Spinner /> : <Upload className="size-4.5 text-muted-foreground group-hover:text-brand-ink" />}
            </span>
            <span className="text-sm font-medium">{reading ? "Reading the statement…" : "Choose the statement file, or drop it here"}</span>
            <span className="max-w-md text-xs text-muted-foreground">
              CSV, Excel (.xlsx or .xls) or PDF with text, up to 4 MB, as downloaded from net banking. HDFC, ICICI, SBI, Axis, Kotak, Yes, IDFC and most other banks are read.
            </span>
          </button>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
          {fileError ? (
            <p className="text-sm text-danger" role="alert">
              {fileError}
            </p>
          ) : null}
          {locked ? (
            <form
              className="flex flex-wrap items-end gap-2 rounded-xl border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (password && !reading) void readFile(locked, password);
              }}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="statement-pdf-password" className="flex min-w-0 items-center gap-1.5">
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">Password for {locked.name}</span>
                </Label>
                <Input
                  id="statement-pdf-password"
                  type="password"
                  autoComplete="off"
                  maxLength={MAX_PASSWORD}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={reading}
                  autoFocus
                />
              </div>
              <Button type="submit" size="sm" disabled={!password || reading}>
                {reading ? <Spinner /> : null}
                Read with password
              </Button>
              <p className="w-full text-xs text-muted-foreground">The password is used only to open this file. It is not saved.</p>
            </form>
          ) : null}
        </div>
      ) : null}

      {file ? (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold">{review ? "Columns" : "Step 1 of 2: check the columns"}</p>
              <p className="text-xs text-muted-foreground">
                {problemsOfMapping.length
                  ? "Some columns could not be recognised. Pick them below."
                  : `Read as: ${mapping
                      .map((m, i) => (m ? `${file.grid[headerIndex]?.cells[i] || `Column ${i + 1}`}` : null))
                      .filter(Boolean)
                      .join(", ")}`}
              </p>
              {layout ? (
                <p className="text-xs">
                  <span className="font-medium">{layout}.</span>{" "}
                  <span className="text-muted-foreground">
                    {mapping.includes("vendor") ? "Vendor from its own column." : "Vendor read from the narration."}
                    {mapping.includes("category") ? " Category from its own column." : ""}
                  </span>
                </p>
              ) : null}
            </div>
            {review ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setShowMapping((v) => !v)} disabled={busy}>
                {showMapping ? "Hide columns" : "Correct the columns"}
              </Button>
            ) : null}
          </div>
          {mappingOpen ? (
            <MappingPanel grid={file.grid} headerIndex={headerIndex} mapping={mapping} onHeaderChange={changeHeader} onMappingChange={changeMapping} disabled={busy} />
          ) : null}
          {file.notes.length ? <p className="text-sm text-muted-foreground">{file.notes.join(" ")}</p> : null}
          {parsed && !review ? <StatementPreview lines={parsed.lines.slice(0, PREVIEW_ROWS)} total={parsed.lines.length} mapping={mapping} /> : null}
          {!review ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <Button type="button" onClick={() => parsed && void runReview(parsed, accountId)} disabled={busy || !parsed || !parsed.lines.length}>
                {reviewing ? <Spinner /> : <ArrowRight />}
                Continue to review
              </Button>
              <p className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
                {parsed
                  ? `${plural(parsed.lines.length, "line", "lines")} will be checked against expenses, income, unpaid bills, loans and transfers. Nothing is saved yet.`
                  : "Pick the columns above to read the lines."}
              </p>
              {reviewError ? (
                <p className="w-full text-sm text-danger" role="alert">
                  {reviewError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {parsed ? <StatementOverview statement={parsed} bank={file?.bank ?? null} /> : null}

      {reviewing ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Spinner /> Checking every line against expenses, income, loans, capital and transfers…
        </p>
      ) : null}

      {review && ctx ? (
        <div className="space-y-3">
          {billSummary.count ? (
            <p className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm" role="status">
              <Landmark className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
              <span>
                <span className="font-medium">
                  {plural(billSummary.count, "line settles", "lines settle")} outstanding payments (<Money value={billSummary.amount} exact />).
                </span>{" "}
                <span className="text-muted-foreground">
                  {billSummary.ticked === billSummary.count ? "All are ticked." : `${formatNumber(billSummary.ticked)} ticked.`} Each bill is marked paid on the statement&apos;s date; no new expense is made.
                </span>
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={filter}
              onValueChange={(v) => {
                if (!v) return;
                setFilter(v as ReviewFilter);
                setPageBySide({ out: 0, in: 0 });
              }}
              className="flex-wrap"
            >
              {REVIEW_FILTERS.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value} className="h-10 px-3 text-sm sm:h-8">
                  {f.label} <span className="ml-1 text-muted-foreground tabular-nums">{formatNumber(counts[f.value])}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {ticked.length ? (
            <BulkBar count={ticked.length} pickers={review.pickers} onApply={applyBulk} onClear={() => toggle(rows.map((r) => r.index), false)} />
          ) : null}

          {(["out", "in"] as const).map((side) => {
            const out = side === "out";
            const all = rows.filter((r) => out === isWithdrawal(r.line));
            const shown = visible.filter((r) => out === isWithdrawal(r.line));
            const sidePages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
            // Changing what lines become can shrink the list below the page being shown.
            const current = Math.min(pageBySide[side], sidePages - 1);
            const pageRows = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
            const total = all.reduce((s, r) => s + amountOf(r.line), 0);
            const waiting = all.filter((r) => !r.line.imported && (r.line.attention || r.problem !== null)).length;
            return (
              <section key={side} aria-labelledby={`statement-${side}`} className="space-y-2 rounded-xl border p-3 sm:p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 id={`statement-${side}`} className="flex items-center gap-2 text-base font-semibold">
                    {out ? <ArrowUpRight className="size-4 text-danger" aria-hidden /> : <ArrowDownLeft className="size-4 text-success" aria-hidden />}
                    {out ? "Money out (withdrawals)" : "Money in (deposits)"}
                    <span className="text-sm font-normal text-muted-foreground">{plural(all.length, "line", "lines")}</span>
                  </h3>
                  <Money value={total} exact className={cn("text-base font-semibold tabular-nums", out ? "text-danger" : "text-success")} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {out
                    ? "Payments to vendors, bills, bank charges, loan instalments and transfers to your other accounts."
                    : "Receipts from customers, interest, loans, capital and transfers from your other accounts. A deposit is never made an invoice by itself."}
                </p>
                {all.length ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label={out ? "Where the money out goes" : "Where the money in goes"}>
                    {destinationTotals(all).map((d) => (
                      <li key={d.key} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs">
                        <span className="font-medium">{d.label}</span> {formatNumber(d.count)} · <Money value={d.amount} exact />
                      </li>
                    ))}
                    {waiting ? (
                      <li className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                        {plural(waiting, "line", "lines")} to check
                      </li>
                    ) : null}
                  </ul>
                ) : null}
                {pageRows.length ? (
                  <ReviewTable
                    rows={pageRows}
                    pickers={review.pickers}
                    onToggle={(i, on) => toggle([i], on)}
                    onToggleAll={toggle}
                    onAction={setAction}
                    onEdit={setEditing}
                    disabled={Boolean(run?.busy)}
                  />
                ) : (
                  <EmptyState
                    compact
                    title={all.length ? "No lines in this view" : out ? "No withdrawals in this statement" : "No deposits in this statement"}
                    description={all.length ? "Pick another filter above." : undefined}
                  />
                )}
                {sidePages > 1 ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground tabular-nums">
                      {formatNumber(current * PAGE_SIZE + 1)} to {formatNumber(Math.min(shown.length, (current + 1) * PAGE_SIZE))} of {formatNumber(shown.length)}
                    </span>
                    <Button type="button" size="sm" variant="outline" disabled={current === 0} onClick={() => setPageBySide((p) => ({ ...p, [side]: current - 1 }))}>
                      Previous
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={current >= sidePages - 1} onClick={() => setPageBySide((p) => ({ ...p, [side]: current + 1 }))}>
                      Next
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })}

          <AddBar
            run={run}
            readyCount={ready.length}
            blocked={blocked}
            totals={totals}
            sides={readySides}
            waiting={waitingTotal}
            held={held.length}
            onAdd={() => setConfirmOpen(true)}
            onRetry={() => run && void addLines(run.pending, run)}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Add ${plural(ready.length, "line", "lines")} to the books?`}
        description={
          <>
            <span className="block">Each line goes to the place shown, tied to this statement&apos;s account:</span>
            <span className="mt-2 block space-y-1">
              {destinationTotals(ready).map((d) => (
                <span key={d.key} className="flex items-baseline justify-between gap-4 text-sm">
                  <span>
                    {d.label} <span className="text-muted-foreground">({formatNumber(d.count)})</span>
                  </span>
                  <Money value={d.amount} exact className="tabular-nums" />
                </span>
              ))}
            </span>
            <span className="mt-2 block text-muted-foreground">
              Money out <Money value={readySides.out} exact />, money in <Money value={readySides.in} exact />.
              {blocked ? ` ${plural(blocked, "ticked line still needs", "ticked lines still need")} details and will not be added.` : ""}
            </span>
            {groupRows.length ? (
              <span className="mt-2 block rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-sm text-foreground">
                {groupRows.map((r) => (
                  <span key={r.index} className="block">
                    Row {r.line.line}, <Money value={amountOf(r.line)} exact /> {isWithdrawal(r.line) ? "to" : "from"} {r.line.group}, your group company, is added as{" "}
                    {checkLabel(r, review?.pickers ?? null)}.
                  </span>
                ))}
                <span className="block text-muted-foreground">If it was a loan, a repayment or a transfer, cancel and change it in the review first.</span>
              </span>
            ) : null}
            {defaulted.length ? (
              <span className="mt-2 block rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-sm text-foreground">
                <span className="block">
                  {plural(
                    defaulted.reduce((n, g) => n + g.count, 0),
                    "line was",
                    "lines were",
                  )}{" "}
                  not recognised from earlier records and {defaulted.reduce((n, g) => n + g.count, 0) === 1 ? "is" : "are"} added with the default shown:
                </span>
                {defaulted.map((g) => (
                  <span key={g.label} className="flex items-baseline justify-between gap-4">
                    <span>
                      {g.label} <span className="text-muted-foreground">({formatNumber(g.count)})</span>
                    </span>
                    <Money value={g.amount} exact className="tabular-nums" />
                  </span>
                ))}
                <span className="block text-muted-foreground">You can change any of them afterwards on Total expenses or Income, and the books follow.</span>
              </span>
            ) : null}
            {held.length ? (
              <span className="mt-2 block text-sm text-muted-foreground">
                {plural(held.length, "line that may already be in the books stays", "lines that may already be in the books stay")} unticked and{" "}
                {held.length === 1 ? "is" : "are"} not added ({held[0]!.line.holdBack?.replace(/\.$/, "").toLowerCase()}
                {held.length > 1 ? ", and others" : ""}). Tick {held.length === 1 ? "it" : "them"} to add.
              </span>
            ) : null}
            {leftOut ? <span className="mt-2 block text-sm text-muted-foreground">{plural(leftOut, "unticked line is", "unticked lines are")} left out.</span> : null}
          </>
        }
        confirmLabel="Add"
        destructive={false}
        onConfirm={() => {
          if (!ready.length) return;
          void addLines(
            ready.map((r) => r.index),
            null,
          );
        }}
      />

      {review && ctx ? (
        <LineEditor
          line={editingLine}
          decision={editing !== null ? (decisions[editing] ?? null) : null}
          accountId={review.accountId}
          pickers={review.pickers}
          onChange={(d) => {
            if (editing === null) return;
            setDecision(editing, d);
            // Editing a line in the drawer counts as reviewing it, like picking its action in the row.
            toggle([editing], true);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function AddBar({
  run,
  readyCount,
  blocked,
  totals,
  sides,
  waiting,
  held,
  onAdd,
  onRetry,
}: {
  run: Run | null;
  readyCount: number;
  blocked: number;
  totals: { expense: number; income: number; created: number; matched: number; ignored: number };
  sides: { out: number; in: number };
  waiting: number;
  held: number;
  onAdd: () => void;
  onRetry: () => void;
}) {
  if (run?.busy) {
    const done = run.total - run.pending.length;
    return (
      <div className="space-y-2 rounded-xl border p-4" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Spinner /> Adding lines
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatNumber(done)} of {formatNumber(run.total)}
          </span>
        </div>
        <Progress value={run.total ? Math.round((done / run.total) * 100) : 0} aria-label="Adding progress" />
        <p className="text-xs text-muted-foreground">Keep this page open until it finishes. Each line is saved on its own, so one bad line does not stop the rest.</p>
      </div>
    );
  }
  if (run?.error) {
    return (
      <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
        <p className="text-danger" role="alert">
          {run.error}
        </p>
        <p className="text-muted-foreground">
          {plural(run.total - run.pending.length, "line was", "lines were")} done, {plural(run.pending.length, "line is", "lines are")} left.
        </p>
        <Button type="button" onClick={onRetry}>
          <RefreshCw />
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-card backdrop-blur sm:p-4">
      <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
        {readyCount ? (
          <>
            {plural(readyCount, "ticked line is", "ticked lines are")} ready: {plural(totals.created, "new record", "new records")}, {formatNumber(totals.matched)} already recorded,{" "}
            {formatNumber(totals.ignored)} to ignore. Money out <Money value={sides.out} exact />, money in <Money value={sides.in} exact />.
          </>
        ) : (
          "Tick the lines to add."
        )}
        {held ? <span> {plural(held, "line that may already be in the books is", "lines that may already be in the books are")} left unticked.</span> : null}
        {waiting ? <span> {plural(waiting, "unticked line waits", "unticked lines wait")} for your choice.</span> : null}
        {blocked ? <span className="text-warning"> {plural(blocked, "ticked line needs", "ticked lines need")} details first.</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onAdd} disabled={!readyCount}>
          Add {plural(readyCount, "line", "lines")}
        </Button>
      </div>
    </div>
  );
}
