import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { MongoClient } from "mongodb";
import { googleStatus, isAllowedCompanyEmail } from "./google";
import { DB_NAME } from "@/server/db-name";

const globalForAuth = globalThis as unknown as { __authMongo?: MongoClient };
const client = (globalForAuth.__authMongo ??= new MongoClient(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017"));
// Users and sessions live in the same database as everything else.
const db = client.db(DB_NAME);

/**
 * Lets an admin create team members while public sign-up is closed:
 * `allowAccountCreation.run(true, () => auth.api.signUpEmail(...))`.
 */
export const allowAccountCreation = new AsyncLocalStorage<boolean>();

const openSignUp = () => process.env.ALLOW_OPEN_SIGNUP === "true";
const google = googleStatus();
const isOAuthCallback = (path: string | undefined) => Boolean(path && (path.startsWith("/callback") || path.startsWith("/oauth2/callback")));

export const auth = betterAuth({
  appName: "Biios Project Manager",
  baseURL:
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
  secret: process.env.BETTER_AUTH_SECRET,
  database: mongodbAdapter(db),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
  // "Continue with Google" when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set and look right.
  socialProviders: google.enabled
    ? {
        google: {
          clientId: google.clientId!,
          clientSecret: google.clientSecret!,
          // Always show the account chooser, so people with several Google accounts pick the work one.
          prompt: "select_account",
        },
      }
    : {},
  account: {
    // A Google sign-in with the email of an existing account links Google to that account.
    // Google verifies email ownership; local accounts are marked verified because only admins
    // (or the first-run setup) create them while sign-up is closed (see setup-db.ts).
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  // Origins allowed to call the auth API besides baseURL (the portal sets APP_ORIGINS for review servers).
  trustedOrigins: [
    ...(process.env.APP_ORIGINS ?? process.env.TRUSTED_ORIGINS ?? "").split(","),
    // Vercel sets these for every deployment, so preview and branch URLs can sign in too.
    ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
      .filter(Boolean)
      .map((host) => `https://${host}`),
  ]
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 6 },
      "/sign-up/email": { window: 60, max: 3 },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
    },
    /**
     * Gate for Google sign-ins. New accounts only for allowed company domains (or the first
     * account, or open sign-up); existing accounts may always link and sign in. Rejections
     * come back to /sign-in?error=<code>.
     */
    validateUserInfo: async ({ user, source }) => {
      if (source.method !== "oauth") return;
      if (source.action === "create-user") {
        const firstRun = (await db.collection("user").estimatedDocumentCount()) === 0;
        if (!firstRun && !openSignUp() && !isAllowedCompanyEmail(user.email as string | undefined)) {
          return {
            error: "domain_not_allowed",
            errorDescription: "Use your company Google account, or ask an admin to add you to the team.",
          };
        }
        return;
      }
      // Linking or signing in again: show the Google photo when the account has none yet.
      if (user.image && user.email) {
        await db
          .collection("user")
          .updateOne(
            { email: String(user.email).toLowerCase(), $or: [{ image: null }, { image: { $exists: false } }, { image: "" }] },
            { $set: { image: user.image, updatedAt: new Date() } },
          )
          .catch(() => undefined);
      }
    },
  },
  databaseHooks: {
    user: {
      create: {
        // The first account is the admin. After that, accounts come from an admin (Team members),
        // from Google for allowed company domains, or from open sign-up when ALLOW_OPEN_SIGNUP=true.
        // Accounts created on a trusted path are marked verified so Google can link to them later.
        before: async (user, context) => {
          const existing = await db.collection("user").estimatedDocumentCount();
          if (existing === 0) return { data: { ...user, role: "admin", emailVerified: true } };
          if (allowAccountCreation.getStore()) {
            return { data: { ...user, role: (user.role as string | undefined) ?? "member", emailVerified: true } };
          }
          if (isOAuthCallback(context?.path) && user.emailVerified && isAllowedCompanyEmail(user.email)) {
            return { data: { ...user, role: "member" } };
          }
          if (openSignUp()) return { data: { ...user, role: (user.role as string | undefined) ?? "member" } };
          throw new APIError("FORBIDDEN", {
            code: "signup_closed",
            message: "Sign-up is closed. Ask an admin to add you to the team.",
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;

/** True until the first account exists, so the sign-up page can offer admin setup. */
export async function isFirstRun() {
  return (await db.collection("user").estimatedDocumentCount()) === 0;
}
