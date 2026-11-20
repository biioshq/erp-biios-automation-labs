import "server-only";

import { cleanEnvValue } from "@/server/env-value";

/**
 * Reads a Google Drive folder shared as "Anyone with the link", with an API key (no sign-in):
 * GOOGLE_DRIVE_API_KEY from Google Cloud Console with the Google Drive API enabled.
 * Used to import receipts (as draft expenses) and item photos.
 */

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  /** Set for files shared with an older link; pass it back (ResourceKeys) to read the file. */
  resourceKey?: string | null;
};

const API = "https://www.googleapis.com/drive/v3";
const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

export function driveConfigured(): boolean {
  return Boolean(cleanEnvValue("GOOGLE_DRIVE_API_KEY", process.env.GOOGLE_DRIVE_API_KEY));
}

function apiKey(): string {
  const key = cleanEnvValue("GOOGLE_DRIVE_API_KEY", process.env.GOOGLE_DRIVE_API_KEY);
  if (!key) {
    throw new DriveError(
      "Google Drive import is not set up. An admin needs to add GOOGLE_DRIVE_API_KEY in Vercel (a Google Cloud API key with the Google Drive API enabled), then redeploy.",
      503,
    );
  }
  return key;
}

/**
 * The folder (or single file) id in a Drive link: /drive/folders/<id>, /file/d/<id>, ?id=<id>, or a
 * bare id. Only /folders/ links are known to be folders; `?id=` links (open?id=, uc?id=) and bare ids
 * may be either, so they are "file" and listDriveFolder looks them up, following them when they are
 * a folder. `resourceKey` is the ?resourcekey= of files shared with an older link.
 */
export function parseDriveLink(link: string): { id: string; kind: "folder" | "file"; resourceKey: string | null } | null {
  const text = link.trim();
  const key = /[?&]resourcekey=([A-Za-z0-9_-]{1,200})/i.exec(text)?.[1] ?? null;
  const folder = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(text);
  if (folder) return { id: folder[1]!, kind: "folder", resourceKey: key };
  const file = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(text) ?? /\/document\/d\/([A-Za-z0-9_-]{10,})/.exec(text);
  if (file) return { id: file[1]!, kind: "file", resourceKey: key };
  const query = /[?&]id=([A-Za-z0-9_-]{10,})/.exec(text);
  if (query) return { id: query[1]!, kind: "file", resourceKey: key };
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return { id: text, kind: "file", resourceKey: null };
  return null;
}

/** Resource keys by file id, for files shared with an older link (sent as X-Goog-Drive-Resource-Keys). */
export type ResourceKeys = Record<string, string | null | undefined>;

const RESOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/;

function resourceKeyHeader(keys: ResourceKeys | undefined): Record<string, string> {
  const pairs = Object.entries(keys ?? {})
    .filter(([id, key]) => FILE_ID_RE.test(id) && key && RESOURCE_KEY_RE.test(key))
    .map(([id, key]) => `${id}/${key}`);
  return pairs.length ? { "X-Goog-Drive-Resource-Keys": pairs.join(",") } : {};
}

/** Listing and file details give up after this long; a download gets DOWNLOAD_TIME_LIMIT_MS. */
const REQUEST_TIME_LIMIT_MS = 15_000;
const DOWNLOAD_TIME_LIMIT_MS = 20_000;

const isTimeout = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

async function driveFetch(url: string, timeoutMs = REQUEST_TIME_LIMIT_MS, keys?: ResourceKeys): Promise<Response> {
  let res: Response;
  try {
    const headers = resourceKeyHeader(keys);
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs), ...(Object.keys(headers).length ? { headers } : {}) });
  } catch (error) {
    if (isTimeout(error)) throw new DriveError("Google Drive took too long to answer. Try again in a moment.", 504);
    throw new DriveError("Could not reach Google Drive. Try again in a moment.", 503);
  }
  if (res.ok) return res;
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
  const reason = body?.error?.message ?? "";
  if (res.status === 404) throw new DriveError("That Drive folder or file was not found. Check the link, and share it as 'Anyone with the link'.", 404);
  if (res.status === 403 && /api key|API_KEY|not been used|disabled/i.test(reason)) {
    throw new DriveError("Google refused the API key. Check GOOGLE_DRIVE_API_KEY and that the Google Drive API is enabled for it.", 503);
  }
  // Google also answers rate limits with 403 (rateLimitExceeded, userRateLimitExceeded, quota).
  if ((res.status === 403 && /rate ?limit|quota/i.test(`${reason} ${body?.error?.status ?? ""}`)) || res.status === 429) {
    throw new DriveError("Google Drive is limiting requests right now. Wait a minute, then continue.", 429);
  }
  if (res.status === 403) throw new DriveError("Google Drive refused access. Share the folder as 'Anyone with the link' (Viewer).", 403);
  if (res.status === 400 && /api key/i.test(reason)) throw new DriveError("Google refused the API key. Check GOOGLE_DRIVE_API_KEY.", 503);
  throw new DriveError(`Google Drive answered with an error (${res.status}).`, 502);
}

type ApiFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; resourceKey?: string };
const FIELDS = "id,name,mimeType,size,modifiedTime,resourceKey";
const toDriveFile = (f: ApiFile): DriveFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  size: f.size ? Number(f.size) : null,
  modifiedTime: f.modifiedTime ?? null,
  resourceKey: f.resourceKey ?? null,
});

/** Files directly inside a shared folder (not trashed), or the single shared file. Images and PDFs only when `only` is given. */
export async function listDriveFiles(link: string, only?: (mimeType: string) => boolean): Promise<DriveFile[]> {
  return (await listDriveFolder(link, only)).files;
}

/**
 * As listDriveFiles, and also which folder the link turned out to be (null for a single file) with
 * its resource key. A link that may be either (?id=, a bare id) is looked up first.
 */
export async function listDriveFolder(
  link: string,
  only?: (mimeType: string) => boolean,
): Promise<{ folderId: string | null; folderResourceKey: string | null; files: DriveFile[] }> {
  const parsed = parseDriveLink(link);
  if (!parsed) throw new DriveError("That does not look like a Google Drive folder or file link.");
  const key = apiKey();
  const keys: ResourceKeys = { [parsed.id]: parsed.resourceKey };
  if (parsed.kind === "file") {
    const res = await driveFetch(`${API}/files/${parsed.id}?fields=${FIELDS}&supportsAllDrives=true&key=${encodeURIComponent(key)}`, REQUEST_TIME_LIMIT_MS, keys);
    const f = (await res.json()) as ApiFile;
    if (f.mimeType !== FOLDER_MIME) {
      const file = toDriveFile(f);
      if (!file.resourceKey && parsed.resourceKey) file.resourceKey = parsed.resourceKey;
      return { folderId: null, folderResourceKey: null, files: !only || only(file.mimeType) ? [file] : [] };
    }
    return listFolder(f.id, f.resourceKey ?? parsed.resourceKey, key, only);
  }
  return listFolder(parsed.id, parsed.resourceKey, key, only);
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function listFolder(folderId: string, folderResourceKey: string | null, key: string, only?: (mimeType: string) => boolean) {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const res = await driveFetch(
      `${API}/files?q=${q}&fields=nextPageToken,files(${FIELDS})&pageSize=1000&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}&key=${encodeURIComponent(key)}`,
      REQUEST_TIME_LIMIT_MS,
      { [folderId]: folderResourceKey },
    );
    const page = (await res.json()) as { nextPageToken?: string; files?: ApiFile[] };
    for (const f of page.files ?? []) {
      if (f.mimeType === FOLDER_MIME) continue;
      if (only && !only(f.mimeType)) continue;
      out.push(toDriveFile(f));
    }
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < 2000);
  return { folderId, folderResourceKey, files: out };
}

/** One shared file's name, type and size (a shared file the API key can read). */
export async function getDriveFile(fileId: string, keys?: ResourceKeys): Promise<DriveFile> {
  if (!FILE_ID_RE.test(fileId)) throw new DriveError("Invalid Drive file id.");
  const res = await driveFetch(`${API}/files/${fileId}?fields=${FIELDS}&supportsAllDrives=true&key=${encodeURIComponent(apiKey())}`, REQUEST_TIME_LIMIT_MS, keys);
  return toDriveFile((await res.json()) as ApiFile);
}

/** Downloads one file's bytes (a shared file the API key can read). */
export async function downloadDriveFile(fileId: string, maxBytes: number, keys?: ResourceKeys): Promise<Buffer> {
  if (!FILE_ID_RE.test(fileId)) throw new DriveError("Invalid Drive file id.");
  const res = await driveFetch(`${API}/files/${fileId}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(apiKey())}`, DOWNLOAD_TIME_LIMIT_MS, keys);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new DriveError(`This file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (isTimeout(error)) throw new DriveError("Downloading the file from Google Drive took too long. Try again in a moment.", 504);
    throw new DriveError("The download from Google Drive stopped part way. Try again in a moment.", 503);
  }
  if (buffer.byteLength > maxBytes) throw new DriveError(`This file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
  return buffer;
}

export const isImageOrPdf = (mimeType: string) => mimeType.startsWith("image/") || mimeType === "application/pdf";
export const isImage = (mimeType: string) => mimeType.startsWith("image/");
