"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/forms/fields";
import { signIn, signUp } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-errors";
import { GoogleIcon } from "./google-icon";

const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

/** Where to go after signing in: the page that sent people here, or the Finance dashboard. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/api/") ? next : "/";
}

export function AuthForm({
  mode,
  firstRun = false,
  google = false,
}: {
  mode: "sign-in" | "sign-up";
  firstRun?: boolean;
  /** Show "Continue with Google" (the server has a Google OAuth client configured). */
  google?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const isSignUp = mode === "sign-up";
  const next = safeNext(params.get("next"));
  // A failed Google sign-in comes back as ?error=<code>&error_description=...
  const [error, setError] = useState<string | null>(() => authErrorMessage(params.get("error"), params.get("error_description")));
  const [googleLoading, setGoogleLoading] = useState(false);
  const form = useForm<{ name?: string; email: string; password: string }>({
    resolver: zodResolver(isSignUp ? signUpSchema : signInSchema) as never,
    defaultValues: { name: "", email: "", password: "" },
  });
  const busy = form.formState.isSubmitting || googleLoading;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const result = isSignUp
      ? await signUp.email({ name: values.name!, email: values.email, password: values.password })
      : await signIn.email({ email: values.email, password: values.password });
    if (result.error) {
      setError(result.error.message ?? "Could not sign you in. Check your details and try again.");
      return;
    }
    router.replace(next);
    router.refresh();
  });

  async function continueWithGoogle() {
    setError(null);
    setGoogleLoading(true);
    try {
      const errorPage = isSignUp ? "/sign-up" : "/sign-in";
      const result = await signIn.social({
        provider: "google",
        callbackURL: next,
        newUserCallbackURL: "/",
        errorCallbackURL: next === "/" ? errorPage : `${errorPage}?next=${encodeURIComponent(next)}`,
      });
      // On success the browser is already on its way to Google; only errors return here.
      if (result.error) {
        setError(authErrorMessage(result.error.code, result.error.message) ?? "Google sign-in could not start. Please try again.");
        setGoogleLoading(false);
      }
    } catch {
      setError("Google sign-in could not start. Check your connection and try again.");
      setGoogleLoading(false);
    }
  }

  const subtitle = isSignUp
    ? firstRun
      ? "This first account manages the team. You can add everyone else from Team members."
      : "Use your work email."
    : google
      ? "Use your company Google account, or the email and password your admin set up for you."
      : "Use the email and password your admin set up for you.";

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="space-y-2">
        <p className="eyebrow">{isSignUp ? (firstRun ? "First-time setup" : "Join the team") : "Project Manager"}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {isSignUp ? (firstRun ? "Create the admin account" : "Create your account") : "Sign in to Project Manager"}
        </h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {google ? (
        <div className="space-y-5">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 w-full gap-2.5 bg-card text-[15px] font-medium sm:h-11"
            onClick={continueWithGoogle}
            disabled={busy}
            aria-busy={googleLoading}
          >
            {googleLoading ? <Spinner /> : <GoogleIcon className="size-[18px]" />}
            {googleLoading ? "Opening Google…" : "Continue with Google"}
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
            <span className="h-px flex-1 bg-border" />
            or with email
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {isSignUp ? <TextField control={form.control} name="name" label="Full name" placeholder="Aarav Mehta" autoFocus /> : null}
        <TextField
          control={form.control}
          name="email"
          label="Work email"
          type="email"
          placeholder="you@biios.in"
          autoFocus={!isSignUp && !google}
          disabled={googleLoading}
        />
        <TextField control={form.control} name="password" label="Password" type="password" placeholder="••••••••" disabled={googleLoading} />
        <Button type="submit" size="lg" className="h-12 w-full text-[15px] sm:h-11" disabled={busy}>
          {form.formState.isSubmitting ? <Spinner /> : null}
          {isSignUp ? "Create account" : "Sign in"}
          {!form.formState.isSubmitting ? <ArrowRight /> : null}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        ) : firstRun ? (
          <>
            Setting up for the first time?{" "}
            <Link href="/sign-up" className="font-medium text-brand-ink underline-offset-4 hover:underline">
              Create the admin account
            </Link>
          </>
        ) : (
          "Need access? Ask an admin to add you to the team."
        )}
      </p>
    </div>
  );
}
