"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, type FileDTO } from "@/features/files/types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { emitDataChanged } from "@/lib/events";
import type { ActionResult } from "@/lib/action-result";

/**
 * Papers kept with an asset or investment: purchase invoice, warranty card, FD receipt, photos.
 * A file is uploaded first and then attached to the record, so it is saved as soon as it is dropped.
 */
export function RecordDocuments({
  documents,
  canRemove,
  attach,
  remove,
  onChanged,
  hint = "Invoice, warranty card, photos or any other paper",
}: {
  documents: FileDTO[];
  /** Only admins delete files. */
  canRemove: boolean;
  attach: (fileIds: string[]) => Promise<ActionResult<unknown>>;
  remove: (fileId: string) => Promise<ActionResult<unknown>>;
  onChanged: () => void;
  hint?: string;
}) {
  const [removing, setRemoving] = useState<FileDTO | null>(null);

  async function uploaded(file: FileDTO) {
    const result = await attach([file.id]);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${file.name} added`);
    emitDataChanged();
    onChanged();
  }

  async function confirmRemove() {
    if (!removing) return false;
    const result = await remove(removing.id);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${removing.name} removed`);
    emitDataChanged();
    onChanged();
    return true;
  }

  return (
    <div className="space-y-3">
      {documents.length ? (
        <div className="grid gap-2">
          {documents.map((d) => (
            <FileTile key={d.id} file={d} onRemove={canRemove ? () => setRemoving(d) : undefined} />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <FileText className="size-4" /> No documents yet.
        </p>
      )}
      <FileDropzone
        meta={{ kind: "document" }}
        accept={ACCEPT_DOCUMENTS}
        compact
        title="Drop documents or click to browse"
        hint={`${hint}. Up to ${MAX_UPLOAD_LABEL} each.`}
        onUploaded={uploaded}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this document?"
        description={removing ? `${removing.name} is deleted from storage.` : undefined}
        confirmLabel="Remove"
        onConfirm={confirmRemove}
      />
    </div>
  );
}
