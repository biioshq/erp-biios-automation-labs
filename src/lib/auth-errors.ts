/**
 * Friendly text for sign-in errors, including the codes Better Auth puts in the URL
 * after a Google sign-in fails (/sign-in?error=<code>&error_description=...). Client-safe.
 */
const MESSAGES: Record<string, string> = {
  domain_not_allowed: "Use your company Google account. Other Google accounts can only sign in after an admin adds you to the team.",
  signup_closed: "There is no account for this Google email yet. Ask an admin to add you to the team, then continue with Google again.",
  signup_disabled: "There is no account for this Google email yet. Ask an admin to add you to the team.",
  account_not_linked: "This email already has an account that could not be linked to Google. Sign in with your password, or ask an admin for help.",
  unable_to_link_account: "Google could not be linked to your existing account. Sign in with your password, or try again.",
  unable_to_create_user: "Your account could not be created. Ask an admin to add you to the team.",
  email_not_found: "Google did not share an email address for this account. Try another Google account.",
  access_denied: "Google sign-in was cancelled.",
  state_not_found: "The sign-in took too long or was opened in another tab. Please try again.",
  state_mismatch: "The sign-in took too long or was opened in another tab. Please try again.",
  invalid_code: "Google sign-in expired. Please try again.",
  no_code: "Google sign-in did not complete. Please try again.",
  unable_to_get_user_info: "Google did not return your profile. Please try again.",
  provider_not_found: "Google sign-in is not set up on this server yet.",
};

export function authErrorMessage(code: string | null | undefined, description?: string | null): string | null {
  if (!code) return null;
  const key = code.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return MESSAGES[key] ?? description ?? "Sign-in did not complete. Please try again.";
}
