import { z } from "zod";

/**
 * Environment contract. Checked once at server start (src/instrumentation.ts),
 * so a misconfigured deployment fails loudly at boot instead of on first use.
 */
const isProd = process.env.NODE_ENV === "production";

const schema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
  BETTER_AUTH_SECRET: isProd
    ? z.string().min(32, "must be at least 32 characters in production (openssl rand -base64 32)")
    : z.string().min(1),
  BETTER_AUTH_URL: z.url().optional(),
  ALLOW_OPEN_SIGNUP: z.enum(["true", "false"]).optional(),
  STORAGE_DIR: z.string().optional(),
  CRON_SECRET: z.string().min(16, "must be at least 16 characters").optional(),
  // Google sign-in (optional): an OAuth client from Google Cloud Console.
  GOOGLE_CLIENT_ID: z.string().endsWith(".apps.googleusercontent.com", "should end with .apps.googleusercontent.com").optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  GOOGLE_ALLOWED_DOMAINS: z.string().optional(),
  RECURRING_SCHEDULER: z.enum(["on", "off"]).optional(),
  // File storage on Vercel: Cloudinary (recommended) or an S3-compatible bucket.
  CLOUDINARY_URL: z.string().regex(/^cloudinary:\/\/[^:]+:[^@]+@.+/, "must look like cloudinary://<api_key>:<api_secret>@<cloud_name>").optional(),
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
  if (Boolean(d.GOOGLE_CLIENT_ID) !== Boolean(d.GOOGLE_CLIENT_SECRET)) {
    throw new Error("Invalid environment configuration:\n  - Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.");
  }
  if (d.CLOUDINARY_CLOUD_NAME && !d.CLOUDINARY_URL && !(d.CLOUDINARY_API_KEY && d.CLOUDINARY_API_SECRET)) {
    throw new Error("Invalid environment configuration:\n  - CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required with CLOUDINARY_CLOUD_NAME.");
  }
  if (process.env.VERCEL && !d.CLOUDINARY_URL && !d.CLOUDINARY_CLOUD_NAME && !d.S3_BUCKET) {
    console.warn("[env] No file storage on Vercel: set CLOUDINARY_URL so receipts and documents can be uploaded.");
  }
  if (process.env.VERCEL && !parsed.data.CRON_SECRET) {
    console.warn("[env] No CRON_SECRET on Vercel: recurring expenses will not post until it is set.");
  }
  if (isProd && parsed.data.ALLOW_OPEN_SIGNUP === "true") {
    console.warn("[env] ALLOW_OPEN_SIGNUP=true: anyone who can reach the app can create an account.");
  }
  return parsed.data;
}
