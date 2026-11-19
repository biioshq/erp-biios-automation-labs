import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/features/auth/auth-form";
import { getCurrentUser } from "@/server/auth/session";
import { isFirstRun } from "@/server/auth/auth";
import { allowedGoogleDomains, googleEnabled } from "@/server/auth/google";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/finance");
  const firstRun = await isFirstRun().catch(() => false);
  const open = firstRun || process.env.ALLOW_OPEN_SIGNUP === "true";
  if (!open) {
    const domains = googleEnabled() ? allowedGoogleDomains() : [];
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border bg-card">
          <Lock className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Sign-up is invite only</h2>
        <p className="text-sm text-muted-foreground">An admin adds team members from Team members. Ask them for an account.</p>
        {domains.length ? (
          <p className="text-sm text-muted-foreground">
            Have a company Google account ({domains.map((d) => `@${d}`).join(", ")})? Use Continue with Google on the sign-in page.
          </p>
        ) : null}
        <Button asChild variant="outline" className="rounded-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <Suspense>
      <AuthForm mode="sign-up" firstRun={firstRun} google={googleEnabled()} />
    </Suspense>
  );
}
