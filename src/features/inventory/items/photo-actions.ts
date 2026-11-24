"use server";

import { z } from "zod";
import { defineAction } from "@/server/action";
import { objectId } from "@/lib/zod";
import { assignItemPhoto, discardPhotoUploads, removeItemPhoto } from "@/features/files/item-photos";

/** A photo shows on the item lists and the item page. */
const REVALIDATE: [string, "layout"][] = [["/inventory", "layout"]];

/**
 * Saves an uploaded photo (POST /api/files with kind "photo") as the item's photo. Needs the items
 * edit permission; the old photo file is deleted only after the new one is saved.
 */
export const setItemPhoto = defineAction(
  z.object({ itemId: objectId, fileId: objectId }),
  async ({ itemId, fileId }, user) => {
    const outcome = await assignItemPhoto({ itemId, fileId, replace: true, uploadedBy: user.id });
    return { replaced: outcome.status === "saved" && outcome.replaced };
  },
  { permission: "inventory.items:edit", revalidate: REVALIDATE, message: "Photo saved" },
);

/** Takes the photo off the item and deletes the stored file. Needs the items delete permission. */
export const deleteItemPhoto = defineAction(
  z.object({ itemId: objectId, fileId: objectId.nullish() }),
  async ({ itemId, fileId }) => removeItemPhoto({ itemId, expectedFileId: fileId ?? null }),
  { permission: "inventory.items:delete", revalidate: REVALIDATE, message: "Photo removed" },
);

/** Deletes the person's own photo upload when saving it on the item failed, so no orphan is left. */
export const discardItemPhotoUpload = defineAction(
  z.object({ fileId: objectId }),
  async ({ fileId }, user) => {
    await discardPhotoUploads([fileId], user.id);
    return { ok: true };
  },
  // Only ever deletes the caller's own unattached uploads, so anyone signed in may clean up.
  { permission: null, readOnly: true },
);
