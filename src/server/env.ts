import { z } from "zod";
import { cloudinaryStatus } from "./cloudinary-config";
import { googleStatus } from "./auth/google";

/**
 * Environment contract. Checked once at server start (src/instrumentation.ts),
 * so a misconfigured deployment fails loudly at boot instead of on first use.
 */
const isProd = process.env.NODE_ENV === "production";

const schema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
  MONGODB_DB: z
    .string()
    .regex(/^[^/\\. "$*<>:|?]{1,63}$/, "is not a valid MongoDB database name")
    .optional(),
  MONGODB_COPY_FROM: z.string().optional(),
  BETTER_AUTH_SECRET: isProd
    ? z.string().min(32, "must be at least 32 characters in production (openssl rand -base64 32)")
    : z.string().min(1),
  BETTER_AUTH_URL: z.url().optional(),
  ALLOW_OPEN_SIGNUP: z.enum(["true", "false"]).optional(),
  STORAGE_DIR: z.string().optional(),
  CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
  // Google sign-in (optional): an OAuth client from Google Cloud Console. Checked in auth/google.ts,
  // which turns Google off with a reason instead of stopping the app.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ALLOWED_DOMAINS: z.string().optional(),
  // Google Drive import (optional): an API key with the Google Drive API enabled.
  GOOGLE_DRIVE_API_KEY: z.string().optional(),
  RECURRING_SCHEDULER: z.enum(["on", "off"]).optional(),
  // File storage on Vercel: Cloudinary (recommended) or an S3-compatible bucket. Cloudinary values
  // are checked in cloudinary-config.ts, which also accepts them pasted with quotes or "NAME=".
  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().optional(),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  if (parsed.data.S3_BUCKET && !(parsed.data.S3_ACCESS_KEY_ID && parsed.data.S3_SECRET_ACCESS_KEY)) {
    throw new Error("Invalid environment configuration:\n  - S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required with S3_BUCKET.");
  }
  const d = parsed.data;
  const google = googleStatus();
  if (google.attempted && !google.enabled) {
    for (const message of google.problems) console.warn(`[env] Google sign-in is off: ${message}`);
  }
  // Cloudinary problems only stop uploads, which then say what to fix, so they warn instead of
  // stopping the whole app.
  const cloudinary = cloudinaryStatus();
  for (const message of [...cloudinary.problems, ...cloudinary.notes]) console.warn(`[env] Cloudinary: ${message}`);
  if (process.env.VERCEL && !cloudinary.wanted && !d.S3_BUCKET) {
    console.warn("[env] No file storage on Vercel: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET so receipts and documents can be uploaded.");
  }
  if (process.env.VERCEL && !parsed.data.CRON_SECRET) {
    console.warn("[env] No CRON_SECRET on Vercel: recurring expenses will not post until it is set.");
  }
  if (isProd && parsed.data.ALLOW_OPEN_SIGNUP === "true") {
    console.warn("[env] ALLOW_OPEN_SIGNUP=true: anyone who can reach the app can create an account.");
  }
  return parsed.data;
}
