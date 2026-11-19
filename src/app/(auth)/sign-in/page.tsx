import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/features/auth/auth-form";
import { getCurrentUser } from "@/server/auth/session";
import { isFirstRun } from "@/server/auth/auth";
import { googleEnabled } from "@/server/auth/google";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getCurrentUser()) {
    // Already signed in (for example right after Google): go where they were heading.
    const next = (await searchParams).next;
    const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/finance";
    redirect(target);
  }
  const firstRun = await isFirstRun().catch(() => false);
  return (
    <Suspense>
      <AuthForm mode="sign-in" firstRun={firstRun} google={googleEnabled()} />
    </Suspense>
  );
}
