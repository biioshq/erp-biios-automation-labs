import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cloudinaryStatus, type CloudinarySettings } from "./cloudinary-config";

/**
 * File storage for receipts, documents and attachments.
 *
 * Three drivers behind one API (saveUpload / readStoredFile / deleteStoredFile), picked in this order:
 *   - cloudinary: when CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (or
 *     CLOUDINARY_URL) is set; see cloudinary-config.ts.
 *     Stored as private "authenticated" assets: images and PDFs as image resources, other
 *     files as raw resources. Recommended on Vercel.
 *   - s3:         when S3_BUCKET is set. Any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO).
 *   - local:      files on disk under STORAGE_DIR (default ./storage), for a server or Docker
 *     with a persistent volume. Not usable on Vercel (no persistent disk).
 *
 * Files are private with every driver: the app fetches them server-side and streams them
 * through the auth-checked /api/files/[id] route. Keys are generated here, never taken from
 * the uploaded file name.
 */
export const STORAGE_ROOT = path.resolve(
  /*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "storage"),
);

const ON_VERCEL = Boolean(process.env.VERCEL);

/** Vercel rejects request bodies over 4.5 MB, so uploads there stop at 4 MB. */
export const MAX_UPLOAD_BYTES = (ON_VERCEL ? 4 : 15) * 1024 * 1024;

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/zip": "zip",
  "image/vnd.dwg": "dwg",
  "application/acad": "dwg",
  "image/vnd.dxf": "dxf",
  "application/dxf": "dxf",
  "image/svg+xml": "svg",
};

/** A problem the person uploading should see as is; `status` is the HTTP status to answer with. */
export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/* Drivers */

type DriverName = "local" | "s3" | "cloudinary";

type Driver = {
  name: DriverName;
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
};

function resolveLocalKey(storageKey: string) {
  const full = path.resolve(/*turbopackIgnore: true*/ STORAGE_ROOT, storageKey);
  if (!full.startsWith(STORAGE_ROOT + path.sep)) throw new Error("Invalid storage key");
  return full;
}

const localDriver: Driver = {
  name: "local",
  async put(key, body) {
    const full = resolveLocalKey(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { flag: "wx" });
  },
  get: (key) => readFile(resolveLocalKey(key)),
  async remove(key) {
    await rm(resolveLocalKey(key), { force: true });
  },
};

function s3Driver(): Driver {
  const bucket = process.env.S3_BUCKET!;
  const prefix = (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  const objectKey = (key: string) => (prefix ? `${prefix}/${key}` : key);
  // Created lazily so the AWS SDK only loads when S3 is used.
  let clientPromise: Promise<{ client: import("@aws-sdk/client-s3").S3Client; sdk: typeof import("@aws-sdk/client-s3") }> | null = null;
  const getClient = () =>
    (clientPromise ??= import("@aws-sdk/client-s3").then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        region: process.env.S3_REGION || "auto",
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        credentials:
          process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
            : undefined,
      }),
    })));

  return {
    name: "s3",
    async put(key, body, mimeType) {
      const { client, sdk } = await getClient();
      await client.send(
        new sdk.PutObjectCommand({ Bucket: bucket, Key: objectKey(key), Body: body, ContentType: mimeType }),
      );
    },
    async get(key) {
      const { client, sdk } = await getClient();
      const res = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
      if (!res.Body) throw new Error("Empty object");
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async remove(key) {
      const { client, sdk } = await getClient();
      await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
    },
  };
}

/** Extensions Cloudinary handles as image resources (PDF included); the rest are raw files. */
const CLOUDINARY_IMAGE_EXTENSIONS = new Set(["png", "jpg", "webp", "gif", "pdf", "svg"]);

/** "2026/11/<uuid>.pdf" -> where the file lives on Cloudinary. */
export function cloudinaryLocation(storageKey: string, folder = process.env.CLOUDINARY_FOLDER || "biios-pm") {
  const dot = storageKey.lastIndexOf(".");
  const extension = dot > 0 ? storageKey.slice(dot + 1).toLowerCase() : "";
  const base = storageKey.slice(0, dot > 0 ? dot : undefined);
  const isImage = CLOUDINARY_IMAGE_EXTENSIONS.has(extension);
  return {
    resourceType: (isImage ? "image" : "raw") as "image" | "raw",
    // Image public ids carry no extension (Cloudinary keeps the format); raw ids keep theirs.
    publicId: `${folder.replace(/^\/+|\/+$/g, "")}/${isImage ? base : storageKey}`,
    format: isImage ? extension : "",
  };
}

/**
 * Turns a Cloudinary error into what to fix. Cloudinary answers bad settings with 401s whose
 * messages name the part that is wrong ("Unknown API key", "Invalid Signature", "Invalid cloud_name").
 */
function cloudinaryFailure(action: string, error: unknown, settings: CloudinarySettings): Error {
  const e = (error ?? {}) as { message?: string; http_code?: number; code?: string; error?: { message?: string; http_code?: number } };
  const message = String(e.message ?? e.error?.message ?? error);
  const status = e.http_code ?? e.error?.http_code;
  const fix = settings.source === "url" ? "CLOUDINARY_URL" : null;
  const where = "(Cloudinary > Settings > API Keys), then redeploy";
  if (/api[_ ]?key/i.test(message)) {
    return new UploadError(`Cloudinary does not recognise the API key. Check ${fix ?? "CLOUDINARY_API_KEY"} ${where}.`, 503);
  }
  if (/signature/i.test(message)) {
    return new UploadError(`Cloudinary rejected the API secret. Check ${fix ?? "CLOUDINARY_API_SECRET"} ${where}; click the eye icon to show the secret before copying it.`, 503);
  }
  if (/cloud[_ ]?name/i.test(message)) {
    return new UploadError(`Cloudinary has no cloud named "${settings.cloudName}". Check ${fix ?? "CLOUDINARY_CLOUD_NAME"} ${where}.`, 503);
  }
  if (status === 401 || status === 403) {
    return new UploadError(`Cloudinary refused the account details. Check ${fix ?? "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET"} ${where}.`, 503);
  }
  if (status === 420 || status === 429) return new UploadError("Cloudinary's usage limit was reached. Try again in a few minutes.", 503);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed? ?out|fetch failed|socket hang up/i.test(`${message} ${e.code ?? ""}`)) {
    return new UploadError("Could not reach Cloudinary. Try again in a moment.", 503);
  }
  return new Error(`Cloudinary ${action} failed (${status ?? "no status"}): ${message}`);
}

function cloudinaryDriver(): Driver {
  type Sdk = typeof import("cloudinary").v2;
  let sdkPromise: Promise<{ cloudinary: Sdk; settings: CloudinarySettings }> | null = null;
  const getSdk = () =>
    (sdkPromise ??= (async () => {
      const { settings, problems } = cloudinaryStatus();
      if (!settings) throw new UploadError(`File storage (Cloudinary) is not set up correctly. ${problems.join(" ")}`, 503);
      // The SDK reads CLOUDINARY_URL by itself on first use and throws on a malformed value, so it
      // gets the cleaned URL, or none when the three separate variables are used.
      if (settings.source === "url") process.env.CLOUDINARY_URL = settings.url;
      else delete process.env.CLOUDINARY_URL;
      const { v2 } = await import("cloudinary");
      v2.config({ cloud_name: settings.cloudName, api_key: settings.apiKey, api_secret: settings.apiSecret, secure: true });
      return { cloudinary: v2, settings };
    })().catch((error) => {
      sdkPromise = null; // try again on the next request
      throw error;
    }));

  return {
    name: "cloudinary",
    async put(key, body) {
      const { cloudinary, settings } = await getSdk();
      const { publicId, resourceType } = cloudinaryLocation(key);
      await new Promise<void>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: resourceType,
            type: "authenticated",
            overwrite: false,
            unique_filename: false,
            use_filename: false,
          },
          (error) => (error ? reject(cloudinaryFailure("upload", error, settings)) : resolve()),
        );
        stream.end(body);
      });
    },
    async get(key) {
      const { cloudinary, settings } = await getSdk();
      const { publicId, resourceType, format } = cloudinaryLocation(key);
      // 1) A signed CDN URL (fast). 2) The signed download API, which also serves PDFs on
      // accounts where PDF delivery through the CDN is switched off.
      const urls = [
        cloudinary.url(publicId, {
          resource_type: resourceType,
          type: "authenticated",
          sign_url: true,
          secure: true,
          ...(format ? { format } : {}),
        }),
        cloudinary.utils.private_download_url(publicId, format, {
          resource_type: resourceType,
          type: "authenticated",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        }),
      ];
      let lastStatus = 0;
      let lastError = "";
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) return Buffer.from(await res.arrayBuffer());
          lastStatus = res.status;
          lastError = res.headers.get("x-cld-error") ?? "";
        } catch {
          // Network error on the CDN: try the download API next.
        }
      }
      if (lastStatus === 401 || lastStatus === 403) {
        throw cloudinaryFailure("download", { http_code: lastStatus, message: lastError }, settings);
      }
      throw new Error(`Cloudinary could not return the file (HTTP ${lastStatus}${lastError ? `: ${lastError}` : ""}).`);
    },
    async remove(key) {
      const { cloudinary, settings } = await getSdk();
      const { publicId, resourceType } = cloudinaryLocation(key);
      await cloudinary.uploader
        .destroy(publicId, { resource_type: resourceType, type: "authenticated", invalidate: true })
        .catch((error: unknown) => {
          throw cloudinaryFailure("delete", error, settings);
        });
    },
  };
}

const globalForStorage = globalThis as unknown as { __storageDriver?: Driver };

/** Which driver is active, for health checks and startup logs. */
export function storageDriverName(): DriverName {
  if (cloudinaryStatus().wanted) return "cloudinary";
  if (process.env.S3_BUCKET) return "s3";
  return "local";
}

function driver(): Driver {
  if (!globalForStorage.__storageDriver) {
    const name = storageDriverName();
    globalForStorage.__storageDriver = name === "cloudinary" ? cloudinaryDriver() : name === "s3" ? s3Driver() : localDriver;
  }
  return globalForStorage.__storageDriver;
}

/* API */

/** Checks the first bytes so a renamed executable can't pose as a PDF or image. */
function sniffMatches(buffer: Buffer, mimeType: string): boolean {
  const head = buffer.subarray(0, 12);
  switch (mimeType) {
    case "application/pdf":
      return head.subarray(0, 5).toString("latin1") === "%PDF-";
    case "image/png":
      return head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG";
    case "image/jpeg":
      return head[0] === 0xff && head[1] === 0xd8;
    case "image/webp":
      return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    case "image/gif":
      return head.subarray(0, 3).toString("latin1") === "GIF";
    default:
      return true;
  }
}

export type StoredFile = {
  storageKey: string;
  size: number;
  mimeType: string;
  checksum: string;
  extension: string;
};

export async function saveUpload(buffer: Buffer, mimeType: string): Promise<StoredFile> {
  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) throw new UploadError("This file type is not supported.");
  if (buffer.byteLength === 0) throw new UploadError("The file is empty.");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(`Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  if (!sniffMatches(buffer, mimeType)) throw new UploadError("The file content does not match its type.");
  if (ON_VERCEL && storageDriverName() === "local") {
    throw new UploadError(
      "File storage is not set up on this deployment. An admin needs to add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Vercel, then redeploy.",
      503,
    );
  }

  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const storageKey = `${dir}/${randomUUID()}.${extension}`;
  await driver().put(storageKey, buffer, mimeType);

  return {
    storageKey,
    size: buffer.byteLength,
    mimeType,
    extension,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function readStoredFile(storageKey: string): Promise<Buffer> {
  if (storageKey.includes("..") || storageKey.startsWith("/")) return Promise.reject(new Error("Invalid storage key"));
  return driver().get(storageKey);
}

export async function deleteStoredFile(storageKey: string) {
  if (storageKey.includes("..") || storageKey.startsWith("/")) throw new Error("Invalid storage key");
  await driver().remove(storageKey);
}

/** 1x1 transparent PNG used to test storage end to end. */
const PROBE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export type StorageCheck = { driver: DriverName; ok: boolean; message: string; problems: string[]; notes: string[] };

/**
 * Uploads a 1x1 image, reads it back and deletes it: proves the storage settings work.
 * For admins, through /api/health?check=storage.
 */
export async function checkStorage(): Promise<StorageCheck> {
  const name = storageDriverName();
  const status = name === "cloudinary" ? cloudinaryStatus() : { problems: [], notes: [], settings: null };
  const base = { driver: name, problems: status.problems, notes: status.notes };
  if (name === "cloudinary" && !status.settings) {
    return { ...base, ok: false, message: "Cloudinary is not set up correctly; see problems." };
  }
  if (ON_VERCEL && name === "local") {
    return { ...base, ok: false, message: "No file storage on Vercel. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, then redeploy." };
  }
  const key = `healthcheck/${randomUUID()}.png`;
  try {
    await driver().put(key, PROBE_PNG, "image/png");
  } catch (error) {
    return { ...base, ok: false, message: `Upload failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  let readBack = "";
  try {
    const bytes = await driver().get(key);
    readBack = bytes.equals(PROBE_PNG) ? "" : " The file came back changed.";
  } catch (error) {
    readBack = ` Reading it back failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  let removed = "";
  try {
    await driver().remove(key);
  } catch (error) {
    removed = ` Deleting the test file failed (${error instanceof Error ? error.message : String(error)}); remove ${key} by hand.`;
  }
  const where =
    name === "cloudinary"
      ? `Cloudinary cloud "${status.settings!.cloudName}" (settings from ${status.settings!.source === "variables" ? "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET" : "CLOUDINARY_URL"})`
      : name === "s3"
        ? `the S3 bucket "${process.env.S3_BUCKET}"`
        : `the folder ${STORAGE_ROOT}`;
  return readBack || removed
    ? { ...base, ok: false, message: `Uploaded to ${where}.${readBack}${removed}` }
    : { ...base, ok: true, message: `Uploads work: a test file was stored in ${where}, read back and deleted.` };
}
