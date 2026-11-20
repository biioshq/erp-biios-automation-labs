/** What the Drive photo import shows for review. Client-safe. */

export type DrivePhotoItem = { id: string; name: string; sku: string; hasPhoto: boolean; photoUrl: string | null };

export type DrivePhotoRow = {
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number | null;
  /** The item the file name points at, or null with the reason. */
  matchedItemId: string | null;
  matchedBy: "sku" | "name" | null;
  unmatchedReason: string | null;
  /** Why this file cannot be imported at all (type or size), or null. */
  problem: string | null;
  /** Set when this Drive file was imported before. */
  importedTo: { itemId: string | null; itemName: string | null } | null;
};

export type DrivePhotoPlan = {
  rows: DrivePhotoRow[];
  items: DrivePhotoItem[];
  /** Upload limit in bytes, for the preview's size notes. */
  maxBytes: number;
};

export type DrivePhotoOutcome =
  | { status: "saved"; replaced: boolean; itemId: string }
  | { status: "skipped"; reason: string; itemId: string };
