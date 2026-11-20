import type { ProjectDocumentType } from "@/lib/constants";

/** A stored file as Client Components see it. */
export type FileDTO = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "receipt" | "document" | "attachment" | "photo";
  documentType: ProjectDocumentType | null;
  /** Inline URL (preview). */
  url: string;
  /** Forces a download. */
  downloadUrl: string;
  createdAt: string;
  uploadedBy?: { id: string; name: string } | null;
};

export const isImage = (f: Pick<FileDTO, "mimeType">) => f.mimeType.startsWith("image/");
export const isPdf = (f: Pick<FileDTO, "mimeType">) => f.mimeType === "application/pdf";

/** Longest side of an item photo in pixels. Photos only show as pictures, so they are shrunk further than receipts. */
export const PHOTO_MAX_EDGE = 1600;

/** Accept strings for <input type="file">. */
/** Item photos: images the browser can show as thumbnails (no SVG, which the file route always downloads). */
export const ACCEPT_PHOTOS = "image/png,image/jpeg,image/webp,image/gif";

export const ACCEPT_RECEIPTS = "image/png,image/jpeg,image/webp,application/pdf";
export const ACCEPT_DOCUMENTS =
  "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,text/csv,.xlsx,.xls,.docx,.doc,.dwg,.dxf,.zip";
