"use client";

import { useState } from "react";
import { Download, Eye, File as FileIcon, FileImage, FileSpreadsheet, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate, formatFileSize } from "@/lib/format";
import { isImage, isPdf, type FileDTO } from "../types";

/** Icon for a file's type. */
export function FileTypeIcon({ file, className }: { file: Pick<FileDTO, "mimeType">; className?: string }) {
  if (isImage(file)) return <FileImage className={className} />;
  if (isPdf(file)) return <FileText className={className} />;
  if (/sheet|excel|csv/.test(file.mimeType)) return <FileSpreadsheet className={className} />;
  return <FileIcon className={className} />;
}

/** Inline preview of an image or PDF; other types offer a download. */
export function FileViewer({ file, className }: { file: FileDTO; className?: string }) {
  if (isImage(file)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={file.url} alt={file.name} className={cn("mx-auto max-h-full w-auto rounded-lg object-contain", className)} />
    );
  }
  if (isPdf(file)) {
    return <iframe src={`${file.url}#toolbar=0&view=FitH`} title={file.name} className={cn("h-full w-full rounded-lg border bg-white", className)} />;
  }
  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-3 text-center", className)}>
      <FileTypeIcon file={file} className="size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No preview for this file type.</p>
      <Button asChild variant="outline" size="sm">
        <a href={file.downloadUrl}>
          <Download /> Download
        </a>
      </Button>
    </div>
  );
}

/** Full-screen preview dialog with a download button. */
export function FilePreviewDialog({ file, open, onOpenChange }: { file: FileDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-w-[min(1100px,96vw)] flex-col gap-3 sm:max-w-[min(1100px,96vw)]">
        {file ? (
          <>
            <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
              <div className="min-w-0">
                <DialogTitle className="truncate">{file.name}</DialogTitle>
                <DialogDescription>
                  {formatFileSize(file.size)} · uploaded {formatDate(file.createdAt)}
                  {file.uploadedBy ? ` by ${file.uploadedBy.name}` : ""}
                </DialogDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href={file.downloadUrl}>
                  <Download /> Download
                </a>
              </Button>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/40 p-2">
              <FileViewer file={file} className="h-full" />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** A file row: icon/thumbnail, name, size, preview, download and optional remove. */
export function FileTile({ file, onRemove, className }: { file: FileDTO; onRemove?: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("group flex items-center gap-3 rounded-lg border bg-card px-3 py-2", className)}>
      <button type="button" onClick={() => setOpen(true)} className="shrink-0" aria-label={`Preview ${file.name}`}>
        {isImage(file) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt="" className="size-9 rounded-md border object-cover" />
        ) : (
          <span className="flex size-9 items-center justify-center rounded-md border bg-muted">
            <FileTypeIcon file={file} className="size-4 text-muted-foreground" />
          </span>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(file.size)} · {formatDate(file.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Preview">
              <Eye />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Preview</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon-sm" aria-label="Download">
              <a href={file.downloadUrl}>
                <Download />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
        {onRemove ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove" className="hover:text-danger">
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <FilePreviewDialog file={file} open={open} onOpenChange={setOpen} />
    </div>
  );
}
