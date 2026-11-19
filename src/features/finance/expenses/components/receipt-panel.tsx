"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { FileScan, RefreshCw, ScanText, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { LOW_CONFIDENCE, type OcrResponse } from "@/lib/ocr";
import { FileViewer } from "@/features/files/components/file-preview";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { httpFailureMessage, uploadFile } from "@/features/files/upload";
import { ACCEPT_RECEIPTS, type FileDTO } from "@/features/files/types";

type Stage = "idle" | "uploading" | "reading";

/** Step 2: read a stored receipt. Never throws: a failure comes back as `ocr: null` with the reason. */
async function readReceipt(fileId: string): Promise<Pick<OcrResponse, "ocr" | "error">> {
  try {
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    const body = (await res.json().catch(() => null)) as Partial<OcrResponse> | null;
    if (res.ok && body) return { ocr: body.ocr ?? null, error: body.error };
    return { ocr: null, error: body?.error ?? httpFailureMessage(res.status, res.headers.get("x-vercel-error"), "Reading") };
  } catch {
    return { ocr: null, error: "Network error while reading the receipt." };
  }
}

/**
 * Upload a receipt (image or PDF), store it, read it with OCR and hand the
 * extracted fields to the form. Shows the receipt beside the form afterwards.
 */
export function ReceiptPanel({
  receipt,
  onRead,
  onRemove,
  summary,
  className,
}: {
  receipt: FileDTO | null;
  onRead: (result: OcrResponse) => void;
  onRemove: () => void;
  summary: { filled: number; low: number; overall: number } | null;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT_RECEIPTS.split(",").includes(file.type)) {
      toast.error("Upload a PNG, JPEG or WebP image, or a PDF.");
      return;
    }
    const shrinkable = file.type !== "application/pdf";
    if (file.size > (shrinkable ? 40 * 1024 * 1024 : MAX_UPLOAD_BYTES)) {
      toast.error(`Receipts can be at most ${shrinkable ? "40 MB" : MAX_UPLOAD_LABEL}.`);
      return;
    }
    setStage("uploading");
    setProgress(0);
    try {
      // Step 1: store the receipt (large photos are shrunk first, under Vercel's request limit).
      const stored = await uploadFile(file, { kind: "receipt" }, setProgress);
      // Step 2: read it. Whatever happens here, the receipt stays attached to the expense.
      setStage("reading");
      const read = await readReceipt(stored.id);
      onRead({ file: stored, ocr: read.ocr, error: read.error });
      if (!read.ocr) {
        toast.warning("Receipt attached, but it could not be read. Fill in the form by hand.", {
          description: read.error,
        });
      }
    } catch (error) {
      toast.error("Could not upload the receipt", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStage("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = stage !== "idle";

  return (
    <div className={cn("flex flex-col gap-3 lg:min-h-0", className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Receipt</p>
          <p className="text-xs text-muted-foreground">Image or PDF. We read it and fill the form for you.</p>
        </div>
        {receipt && !busy ? (
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              <RefreshCw /> Replace
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove receipt" className="hover:text-danger">
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>

      {busy ? (
        <div className="relative flex min-h-40 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border bg-surface/50 p-5 text-center lg:min-h-64 lg:flex-1 lg:gap-4 lg:p-6">
          <motion.div
            aria-hidden
            className="absolute inset-x-6 h-px bg-gradient-to-r from-transparent via-brand to-transparent shadow-[0_0_12px_var(--brand)]"
            initial={{ top: "15%" }}
            animate={{ top: ["15%", "85%", "15%"] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="flex size-12 items-center justify-center rounded-2xl border bg-card shadow-card">
            <ScanText className="size-5 text-brand-ink" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">{stage === "uploading" ? "Uploading receipt…" : "Reading the receipt…"}</p>
            <p className="text-xs text-muted-foreground">
              {stage === "uploading" ? `${Math.round(progress * 100)}%` : "Finding vendor, GSTIN, invoice number, taxes and totals"}
            </p>
          </div>
          <Progress value={stage === "uploading" ? progress * 100 : 100} className={cn("w-48", stage === "reading" && "animate-pulse")} />
        </div>
      ) : receipt ? (
        <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1">
          {summary ? (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                summary.low > 0 ? "border-warning/40 bg-warning/8 text-warning" : "border-success/30 bg-success/8 text-success",
              )}
            >
              {summary.low > 0 ? <TriangleAlert className="size-3.5 shrink-0" /> : <Sparkles className="size-3.5 shrink-0" />}
              <span className="text-foreground">
                Filled {summary.filled} field{summary.filled === 1 ? "" : "s"} from the receipt
                {summary.low > 0 ? `. ${summary.low} highlighted field${summary.low === 1 ? " needs" : "s need"} a check.` : "."}
              </span>
              <span className="tabular ml-auto font-medium">{Math.round(summary.overall * 100)}%</span>
            </div>
          ) : null}
          <div className="min-h-48 overflow-hidden rounded-xl border bg-muted/40 p-2 lg:min-h-72 lg:flex-1">
            <FileViewer file={receipt} className="h-full max-h-[40vh] min-h-48 lg:max-h-[70vh] lg:min-h-72" />
          </div>
        </div>
      ) : (
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
            void handle(e.dataTransfer.files[0]);
          }}
          className={cn(
            "group flex min-h-14 items-center gap-3 rounded-xl border border-dashed bg-surface/40 p-3 text-left transition-colors lg:min-h-64 lg:flex-1 lg:flex-col lg:justify-center lg:p-6 lg:text-center hover:border-brand/50 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            dragging && "border-brand bg-brand/10",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card shadow-card transition-transform group-hover:-translate-y-0.5 lg:size-12 lg:rounded-2xl">
            <FileScan className="size-5 text-muted-foreground group-hover:text-brand-ink" />
          </span>
          <span className="min-w-0 text-sm font-medium lg:contents">
            <span className="block">Drop a receipt or invoice</span>
            <span className="hidden max-w-56 text-xs font-normal text-muted-foreground lg:block">
            PNG, JPEG, WebP or PDF up to {MAX_UPLOAD_LABEL}; large photos are shrunk automatically. Fields read with low confidence are highlighted for you to check.
            </span>
            <span className="block text-xs font-normal text-muted-foreground lg:hidden">Tap to upload or take a photo.</span>
          </span>
        </button>
      )}
      <input ref={inputRef} type="file" accept={ACCEPT_RECEIPTS} className="hidden" onChange={(e) => void handle(e.target.files?.[0])} />
      <p className="text-[11px] text-muted-foreground">
        Highlighted fields scored below {Math.round(LOW_CONFIDENCE * 100)}% confidence.
      </p>
    </div>
  );
}
