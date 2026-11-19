import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage for receipts, documents and attachments.
 *
 * Three drivers behind one API (saveUpload / readStoredFile / deleteStoredFile), picked in this order:
 *   - cloudinary: when CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME + API key + secret) is set.
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

export class UploadError extends Error {}

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

function cloudinaryDriver(): Driver {
  type Sdk = typeof import("cloudinary").v2;
  let sdkPromise: Promise<Sdk> | null = null;
  const getSdk = () =>
    (sdkPromise ??= import("cloudinary").then(({ v2 }) => {
      // CLOUDINARY_URL is read by the SDK itself; the separate variables are an alternative.
      if (!process.env.CLOUDINARY_URL) {
        v2.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });
      }
      v2.config({ secure: true });
      return v2;
    }));

  return {
    name: "cloudinary",
    async put(key, body) {
      const cloudinary = await getSdk();
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
          (error) => (error ? reject(new Error(`Cloudinary upload failed: ${error.message}`)) : resolve()),
        );
        stream.end(body);
      });
    },
    async get(key) {
      const cloudinary = await getSdk();
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
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) return Buffer.from(await res.arrayBuffer());
          lastStatus = res.status;
        } catch {
          // Network error on the CDN: try the download API next.
        }
      }
      throw new Error(`Cloudinary could not return the file (HTTP ${lastStatus}).`);
    },
    async remove(key) {
      const cloudinary = await getSdk();
      const { publicId, resourceType } = cloudinaryLocation(key);
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: "authenticated", invalidate: true });
    },
  };
}

const globalForStorage = globalThis as unknown as { __storageDriver?: Driver };

/** Which driver is active, for health checks and startup logs. */
export function storageDriverName(): DriverName {
  if (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME) return "cloudinary";
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
    throw new UploadError("File storage is not set up on this deployment. An admin needs to add CLOUDINARY_URL (see docs/DEPLOYMENT.md).");
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
