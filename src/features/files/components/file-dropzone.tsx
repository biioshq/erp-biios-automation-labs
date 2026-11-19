"use client";

import { useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/format";
import { uploadFile, type UploadMeta } from "../upload";
import type { FileDTO } from "../types";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../prepare";

// Images are shrunk before upload, so only files that stay large after that are refused.
const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Drag-and-drop (or click) upload area. Uploads immediately to local storage
 * and reports each stored file through `onUploaded`.
 */
export function FileDropzone({
  meta,
  accept,
  multiple = true,
  onUploaded,
  title = "Drop files here or click to browse",
  hint,
  className,
  compact,
  disabled,
}: {
  meta: UploadMeta;
  accept?: string;
  multiple?: boolean;
  onUploaded: (file: FileDTO) => void;
  title?: string;
  hint?: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; size: number; progress: number }[]>([]);

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, multiple ? 20 : 1);
    for (const file of files) {
      const shrinkable = /^image\/(jpeg|png|webp)$/.test(file.type);
      if (file.size > (shrinkable ? MAX_BYTES : MAX_UPLOAD_BYTES)) {
        toast.error(`${file.name} is larger than ${shrinkable ? "40 MB" : MAX_UPLOAD_LABEL}.`);
        continue;
      }
      setUploads((u) => [...u, { name: file.name, size: file.size, progress: 0 }]);
      try {
        const stored = await uploadFile(file, meta, (p) =>
          setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress: p } : x))),
        );
        onUploaded(stored);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload failed");
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface/40 text-center transition-colors hover:border-brand/50 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          compact ? "px-4 py-4" : "px-6 py-8",
          dragging && "border-brand bg-brand/10",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-full border bg-card shadow-card transition-transform group-hover:-translate-y-0.5">
          <CloudUpload className="size-4.5 text-muted-foreground group-hover:text-brand-ink" />
        </span>
        <span className="text-sm font-medium">{title}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {uploads.map((u) => (
        <div key={u.name} className="space-y-1 rounded-lg border px-3 py-2">
          <div className="flex justify-between text-xs">
            <span className="truncate">{u.name}</span>
            <span className="text-muted-foreground">{formatFileSize(u.size)}</span>
          </div>
          <Progress value={Math.round(u.progress * 100)} />
        </div>
      ))}
    </div>
  );
}
