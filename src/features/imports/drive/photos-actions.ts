"use server";

import { z } from "zod";
import { defineAction } from "@/server/action";
import { objectId } from "@/lib/zod";
import { importDrivePhoto, planDrivePhotos } from "./photos-server";

/** Lists a shared Drive folder's images and their matching items, for review. Admin-only, writes nothing. */
export const listDrivePhotos = defineAction(
  z.object({ link: z.string().trim().min(1, "Paste a Google Drive folder link").max(2000) }),
  async ({ link }) => planDrivePhotos(link),
  { role: "admin", readOnly: true },
);

/** Imports one reviewed Drive image as an item's photo. One file per request keeps each call short. */
export const addDrivePhoto = defineAction(
  z.object({
    driveFileId: z.string().regex(/^[A-Za-z0-9_-]{10,}$/, "Invalid Drive file id"),
    name: z.string().trim().min(1).max(255),
    itemId: objectId,
    replace: z.boolean().default(false),
  }),
  async (input, user) => importDrivePhoto(input, user.id),
  // The import screen refreshes once at the end instead of after every file.
  { role: "admin" },
);
