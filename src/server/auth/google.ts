import "server-only";

import { cleanEnvValue } from "@/server/env-value";

/**
 * Google sign-in settings and the rule for who may get a new account through Google.
 *
 * - "Continue with Google" appears only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are both
 *   set and look right; googleStatus() says what is wrong otherwise (also in /api/health).
 * - Someone whose email already has an account (added by an admin, or the first admin)
 *   is linked to Google on first use, whatever their email domain.
 * - Someone new gets an account (role "member") only when their Google email is in an
 *   allowed company domain: GOOGLE_ALLOWED_DOMAINS, comma-separated, default "biios.in".
 *   Set it to an empty value to allow Google only for people an admin has added.
 * - ALLOW_OPEN_SIGNUP=true or an empty database (first account = admin) allow anyone.
 */

export type GoogleStatus = {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  /** Why Google sign-in is off, without repeating any value. Empty when it is on. */
  problems: string[];
  /** Some Google variable is set, so being off is probably a mistake worth a warning. */
  attempted: boolean;
};

/** Names other guides use for the same values; this app reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. */
const LOOKALIKES = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "GOOGLE_ID",
  "GOOGLE_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENTID",
  "GOOGLE_CLIENT_SECRET_KEY",
];
const SEVERAL = /[\r\n]|GOOGLE_[A-Z_]+\s*=/i;
const PLACEHOLDER = /[<>]|\*{3,}|^(your[\s_-]?)?(google[\s_-]?)?client[\s_-]?(id|secret)$/i;
const CLIENT_ID = /^[\w.-]+\.apps\.googleusercontent\.com$/;

export function googleStatus(env: Record<string, string | undefined> = process.env): GoogleStatus {
  const clientId = cleanEnvValue("GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanEnvValue("GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET);
  const lookalikes = LOOKALIKES.filter((name) => cleanEnvValue(name, env[name]));
  const problems: string[] = [];

  if (!clientId && !clientSecret) {
    problems.push(
      lookalikes.length
        ? `GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. Found ${lookalikes.join(", ")}: rename them to GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.`
        : "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.",
    );
    return { enabled: false, problems, attempted: lookalikes.length > 0 };
  }

  if (!clientId) problems.push("GOOGLE_CLIENT_ID is missing. Copy the Client ID from Google Cloud Console > APIs & Services > Credentials.");
  else if (SEVERAL.test(clientId)) problems.push("GOOGLE_CLIENT_ID holds several settings or lines. Put only the Client ID in it, and the secret in GOOGLE_CLIENT_SECRET.");
  else if (PLACEHOLDER.test(clientId)) problems.push("GOOGLE_CLIENT_ID is still a placeholder. Copy the Client ID from Google Cloud Console > APIs & Services > Credentials.");
  else if (!CLIENT_ID.test(clientId)) problems.push("GOOGLE_CLIENT_ID is not a Client ID: it should end with .apps.googleusercontent.com.");

  if (!clientSecret) problems.push("GOOGLE_CLIENT_SECRET is missing. Copy the Client secret from the same OAuth client in Google Cloud Console.");
  else if (SEVERAL.test(clientSecret)) problems.push("GOOGLE_CLIENT_SECRET holds several settings or lines. Put only the Client secret in it.");
  else if (PLACEHOLDER.test(clientSecret)) problems.push("GOOGLE_CLIENT_SECRET is still a placeholder or was copied hidden. Copy the Client secret from Google Cloud Console.");
  else if (/\s/.test(clientSecret)) problems.push("GOOGLE_CLIENT_SECRET contains spaces. Copy the Client secret again.");
  else if (clientId && CLIENT_ID.test(clientSecret)) problems.push("GOOGLE_CLIENT_SECRET holds a Client ID. Put the Client secret (often starting with GOCSPX-) there.");

  return problems.length
    ? { enabled: false, problems, attempted: true }
    : { enabled: true, clientId, clientSecret, problems, attempted: true };
}

export function googleEnabled(): boolean {
  return googleStatus().enabled;
}

export function allowedGoogleDomains(): string[] {
  const raw = process.env.GOOGLE_ALLOWED_DOMAINS ?? "biios.in";
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function isAllowedCompanyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.toLowerCase().split("@")[1];
  return Boolean(domain) && allowedGoogleDomains().includes(domain!);
}
