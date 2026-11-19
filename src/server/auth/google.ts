import "server-only";

/**
 * Google sign-in settings and the rule for who may get a new account through Google.
 *
 * - Google appears only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
 * - Someone whose email already has an account (added by an admin, or the first admin)
 *   is linked to Google on first use, whatever their email domain.
 * - Someone new gets an account (role "member") only when their Google email is in an
 *   allowed company domain: GOOGLE_ALLOWED_DOMAINS, comma-separated, default "biios.in".
 *   Set it to an empty value to allow Google only for people an admin has added.
 * - ALLOW_OPEN_SIGNUP=true or an empty database (first account = admin) allow anyone.
 */

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
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
