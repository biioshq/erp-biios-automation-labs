"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useCan } from "@/components/current-user";
import { uploadFile } from "@/features/files/upload";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { ACCEPT_PHOTOS, PHOTO_MAX_EDGE } from "@/features/files/types";
import { emitDataChanged } from "@/lib/events";
import { deleteItemPhoto, discardItemPhotoUpload, setItemPhoto } from "../photo-actions";
import { ItemThumb } from "./item-photo";

// JPEG, PNG and WebP are shrunk in the browser first, so only files that stay large are refused.
const SHRINKABLE_MAX_BYTES = 40 * 1024 * 1024;
const PHOTO_TYPES = new Set(ACCEPT_PHOTOS.split(","));

/**
 * The item page's photo: people who may edit items can add or change it; removing it (which
 * deletes the stored file) needs the items delete permission.
 */
export function ItemPhotoPanel({ itemId, name, photoFileId, photoUrl }: { itemId: string; name: string; photoFileId: string | null; photoUrl: string | null }) {
  const router = useRouter();
  const canEdit = useCan("inventory.items:edit");
  const canDelete = useCan("inventory.items:delete");
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const busy = progress !== null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES.has(file.type)) {
      toast.error("Use a PNG, JPEG, WebP or GIF image for the photo.");
      return;
    }
    const shrinkable = file.type !== "image/gif";
    if (file.size > (shrinkable ? SHRINKABLE_MAX_BYTES : MAX_UPLOAD_BYTES)) {
      toast.error(`${file.name} is larger than ${shrinkable ? "40 MB" : MAX_UPLOAD_LABEL}.`);
      return;
    }
    setProgress(0);
    try {
      const stored = await uploadFile(file, { kind: "photo" }, (p) => setProgress(p), { maxEdge: PHOTO_MAX_EDGE });
      const result = await setItemPhoto({ itemId, fileId: stored.id });
      if (!result.ok) {
        // Nothing points at the upload, so it is removed again.
        await discardItemPhotoUpload({ fileId: stored.id }).catch(() => undefined);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.replaced ? "Photo changed" : "Photo added");
      emitDataChanged();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    const result = await deleteItemPhoto({ itemId, fileId: photoFileId });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Photo removed");
    emitDataChanged();
    router.refresh();
    return true;
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-2.5 sm:w-48">
      <div className="relative">
        <ItemThumb key={photoUrl ?? "none"} src={photoUrl} name={name} size="lg" eager />
        {busy ? (
          <div className="absolute inset-x-3 bottom-3 rounded-md bg-background/90 p-2 shadow-sm">
            <p className="mb-1 text-[11px] text-muted-foreground">Uploading…</p>
            <Progress value={Math.round((progress ?? 0) * 100)} className="h-1.5" />
          </div>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_PHOTOS}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Camera /> {photoUrl ? "Change photo" : "Add photo"}
          </Button>
        ) : null}
        {canDelete && photoUrl ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setRemoving(true)} className="text-muted-foreground">
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove this photo?"
        description="The photo is deleted for good. The item and its stock are not changed."
        confirmLabel="Remove photo"
        onConfirm={remove}
      />
    </div>
  );
}
