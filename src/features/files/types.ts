import type { ProjectDocumentType } from "@/lib/constants";

/** A stored file as Client Components see it. */
export type FileDTO = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "receipt" | "document" | "attachment";
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

/** Accept strings for <input type="file">. */
export const ACCEPT_RECEIPTS = "image/png,image/jpeg,image/webp,application/pdf";
export const ACCEPT_DOCUMENTS =
  "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,text/csv,.xlsx,.xls,.docx,.doc,.dwg,.dxf,.zip";
