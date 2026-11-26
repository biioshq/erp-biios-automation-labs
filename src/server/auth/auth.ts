import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { MongoClient } from "mongodb";
import { googleStatus, isAllowedCompanyEmail } from "./google";
import { roleMayChangeOwnPassword } from "./roles";
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

/**
 * Better Auth endpoints that let the signed-in person set their own password over HTTP. In
 * better-auth 1.7 that is only /change-password: /set-password is server-only (not routed), and
 * /reset-password needs a reset token, which cannot be issued because sendResetPassword is not set.
 * Admins setting someone's password (setUserPassword) use the adapter directly, not these routes.
 */
const OWN_PASSWORD_PATHS = new Set(["/change-password"]);

/**
 * Refuses a password change when the person's role has "Change own password" unticked. The role
 * is read fresh: the user by id from the database (not the cookie-cached session user), then the
 * role through resolveRole, as for every page. Lookup errors are not swallowed, so the change fails
 * rather than slipping through. No session: the endpoint itself answers 401.
 */
const ownPasswordGate = createAuthMiddleware(async (ctx) => {
  if (!OWN_PASSWORD_PATHS.has(ctx.path)) return;
  const session = await getSessionFromCtx(ctx);
  if (!session?.user?.id) return;
  const user = (await ctx.context.internalAdapter.findUserById(session.user.id)) as { role?: unknown } | null;
  if (!(await roleMayChangeOwnPassword(user?.role))) {
    throw new APIError("FORBIDDEN", {
      code: "password_change_not_allowed",
      message: "Your role does not allow changing your password. Ask an admin to set a new one.",
    });
  }
});

const openSignUp = () => process.env.ALLOW_OPEN_SIGNUP === "true";
const google = googleStatus();
const isOAuthCallback = (path: string | undefined) => Boolean(path && (path.startsWith("/callback") || path.startsWith("/oauth2/callback")));

/**
 * The app's public address: BETTER_AUTH_URL (only the origin part), else Vercel's production
 * address. On Vercel a localhost value (copied from .env.local or .env.example) is ignored, since
 * it can never be right there and would break sign-in links and Google's return address.
 */
function publicBaseURL(): string | undefined {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      const local = /^(localhost|127\.|0\.0\.0\.0$|\[::1\]$)/.test(url.hostname);
      if (!(process.env.VERCEL && local)) return url.origin;
    } catch {
      // Not a URL: env.ts reports it at start-up; fall back to Vercel's address below.
    }
  }
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;
}

const STATIC_TRUSTED_ORIGINS = [
  // Extra origins (the portal sets APP_ORIGINS for review servers; TRUSTED_ORIGINS by hand).
  ...(process.env.APP_ORIGINS ?? process.env.TRUSTED_ORIGINS ?? "").split(","),
  // Vercel sets these for every deployment, so preview and branch URLs can sign in too.
  ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean)
    .map((host) => `https://${host}`),
]
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * The address this request was sent to. A browser's request to the app's own address (any Vercel
 * alias of the project, or a custom domain pointed at it) is same-origin and safe to trust: Vercel
 * only routes a domain here when it belongs to this project, and another website's page still sends
 * its own Origin, which never matches this host, so it is still refused.
 */
function requestOrigin(request: Request | undefined): string[] {
  if (!request) return [];
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  if (!host) return [];
  let proto = first(request.headers.get("x-forwarded-proto"));
  if (!proto) {
    try {
      proto = new URL(request.url).protocol.replace(":", "");
    } catch {
      proto = "https";
    }
  }
  return [`${proto}://${host}`];
}

export const auth = betterAuth({
  appName: "Biios Project Manager",
  baseURL: publicBaseURL(),
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
  // Origins allowed to call the auth API besides baseURL: the fixed list plus the address the
  // request itself was sent to (fixes "Invalid origin" on other Vercel addresses or a custom domain).
  trustedOrigins: (request) => [...STATIC_TRUSTED_ORIGINS, ...requestOrigin(request)],
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
  hooks: { before: ownPasswordGate },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;

/** True until the first account exists, so the sign-up page can offer admin setup. */
export async function isFirstRun() {
  return (await db.collection("user").estimatedDocumentCount()) === 0;
}
