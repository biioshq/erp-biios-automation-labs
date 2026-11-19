"use client";

import { useMemo, useOptimistic, useState, startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Download, Eye, FileStack, LayoutGrid, MoreHorizontal, Receipt, Rows3, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Section } from "@/components/shared/page";
import { StatusBadge } from "@/components/shared/status-badge";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FilePreviewDialog, FileTile, FileTypeIcon } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, isImage, type FileDTO } from "@/features/files/types";
import { PROJECT_DOCUMENT_TYPES, labelOf, type ProjectDocumentType } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatFileSize } from "@/lib/format";
import { removeProjectDocument, setProjectDocumentType } from "../actions";
import type { ExpenseReceipt } from "../types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";

type Change = { kind: "remove"; id: string } | { kind: "type"; id: string; documentType: ProjectDocumentType };

/** Upload, browse, preview and manage project documents; receipts from expenses are listed read-only below. */
export function ProjectDocumentsTab({
  projectId,
  documents,
  receipts,
}: {
  projectId: string;
  documents: FileDTO[];
  receipts: ExpenseReceipt[];
}) {
  const router = useRouter();
  const [docs, apply] = useOptimistic(documents, (state, change: Change) =>
    change.kind === "remove" ? state.filter((d) => d.id !== change.id) : state.map((d) => (d.id === change.id ? { ...d, documentType: change.documentType } : d)),
  );
  const [uploadType, setUploadType] = useState<ProjectDocumentType>("other");
  const [filter, setFilter] = useState<string>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<FileDTO | null>(null);
  const [deleting, setDeleting] = useState<FileDTO | null>(null);

  const visible = useMemo(() => (filter === "all" ? docs : docs.filter((d) => d.documentType === filter)), [docs, filter]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of docs) map.set(d.documentType ?? "other", (map.get(d.documentType ?? "other") ?? 0) + 1);
    return map;
  }, [docs]);

  async function remove(file: FileDTO) {
    startTransition(() => apply({ kind: "remove", id: file.id }));
    const result = await removeProjectDocument({ projectId, fileId: file.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${file.name} deleted`);
    emitDataChanged();
    return true;
  }

  async function changeType(file: FileDTO, documentType: ProjectDocumentType) {
    if (file.documentType === documentType) return;
    startTransition(() => apply({ kind: "type", id: file.id, documentType }));
    const result = await setProjectDocumentType({ projectId, fileId: file.id, documentType });
    if (!result.ok) toast.error(result.error);
    else toast.success(`Marked as ${labelOf(PROJECT_DOCUMENT_TYPES, documentType).toLowerCase()}`);
  }

  return (
    <div className="space-y-6">
      <Section title="Upload" description={`Pick what kind of document it is first, then drop the files. Images, PDF, Excel, Word, CAD and zip files up to ${MAX_UPLOAD_LABEL}.`}>
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Document type</p>
            <Select value={uploadType} onValueChange={(v) => setUploadType(v as ProjectDocumentType)}>
              <SelectTrigger className="w-full" aria-label="Document type for the next upload">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FileDropzone
            meta={{ kind: "document", documentType: uploadType, projectId, entityType: "project", entityId: projectId }}
            accept={ACCEPT_DOCUMENTS}
            title={`Drop ${labelOf(PROJECT_DOCUMENT_TYPES, uploadType).toLowerCase()} files here or click to browse`}
            hint="Several files at once are fine"
            onUploaded={(file) => {
              toast.success(`${file.name} uploaded`);
              emitDataChanged();
              router.refresh();
            }}
          />
        </div>
      </Section>

      <Section
        title="Documents"
        description={`${docs.length} file${docs.length === 1 ? "" : "s"} uploaded to this project`}
        actions={
          docs.length ? (
            <div className="flex items-center gap-2">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-8 w-36" aria-label="Filter by type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types ({docs.length})</SelectItem>
                  {PROJECT_DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label} ({counts.get(t.value) ?? 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ToggleGroup type="single" variant="outline" size="sm" value={layout} onValueChange={(v) => v && setLayout(v as "grid" | "list")} aria-label="Layout">
                <ToggleGroupItem value="grid" aria-label="Grid">
                  <LayoutGrid />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List">
                  <Rows3 />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          ) : null
        }
      >
        {docs.length === 0 ? (
          <EmptyState compact icon={FileStack} title="No documents yet" description="Quotations, bills, drawings and contracts uploaded here stay with the project." />
        ) : visible.length === 0 ? (
          <EmptyState compact icon={FileStack} title="No documents of this type" action={<Button variant="outline" onClick={() => setFilter("all")}>Show all types</Button>} />
        ) : (
          <ul className={layout === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-2"}>
            {visible.map((file) => (
              <li key={file.id} className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-foreground/20">
                <button type="button" onClick={() => setPreview(file)} className="shrink-0" aria-label={`Preview ${file.name}`}>
                  {isImage(file) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.url} alt="" className="size-12 rounded-lg border object-cover" />
                  ) : (
                    <span className="flex size-12 items-center justify-center rounded-lg border bg-muted">
                      <FileTypeIcon file={file} className="size-5 text-muted-foreground" />
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                      {labelOf(PROJECT_DOCUMENT_TYPES, file.documentType ?? "other")}
                    </StatusBadge>
                    <span>
                      {formatFileSize(file.size)} · {formatDate(file.createdAt)}
                    </span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${file.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setPreview(file)}>
                      <Eye /> Preview
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={file.downloadUrl}>
                        <Download /> Download
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
                      <Tags className="size-3" /> Change type
                    </DropdownMenuLabel>
                    {PROJECT_DOCUMENT_TYPES.map((t) => (
                      <DropdownMenuItem key={t.value} onSelect={() => void changeType(file, t.value)}>
                        {t.label}
                        {(file.documentType ?? "other") === t.value ? <Check className="ml-auto" /> : null}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(file)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="From expenses" description="Receipts attached to this project's expenses. Manage them from the expense." >
        {receipts.length === 0 ? (
          <EmptyState compact icon={Receipt} title="No receipts attached to expenses" description="Upload a receipt when adding an expense and it appears here." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {receipts.map(({ file, expense }) => (
              <li key={file.id} className="space-y-1.5">
                <FileTile file={file} />
                <Link href={`/finance/expenses?view=${expense.id}`} className="block truncate px-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                  {expense.number} · {expense.vendor}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <FilePreviewDialog file={preview} open={preview !== null} onOpenChange={(o) => !o && setPreview(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this document?"
        description={deleting ? `${deleting.name} will be removed from the project and from storage.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </div>
  );
}
