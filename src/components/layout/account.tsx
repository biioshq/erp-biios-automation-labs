"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, LogOut, ShieldCheck, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { authClient, signOut } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCan, type CurrentUser } from "@/components/current-user";

/** Profile picture (from Google when linked) with initials as the fallback. */
export function UserAvatar({ user, className }: { user: Pick<CurrentUser, "name" | "image">; className?: string }) {
  return (
    <Avatar className={cn("size-8 rounded-full", className)}>
      {user.image ? (
        // Google photo URLs refuse requests that carry a referrer.
        <AvatarImage src={user.image} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="rounded-[inherit] bg-gradient-to-br from-[#ffad4d] to-[#ff8800] text-xs font-semibold text-[#0b1929]">
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}

export type SignInMethods = { password: boolean; google: boolean } | null;

/**
 * Account state shared by the header profile menu and the sidebar menu: how the person
 * signs in (loaded when a menu first opens) and signing out with a loading state.
 */
export function useAccount() {
  const router = useRouter();
  const [methods, setMethods] = useState<SignInMethods>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadMethods = useCallback(async () => {
    if (methods) return;
    const result = await authClient.listAccounts().catch(() => null);
    if (!result || result.error || !result.data) return;
    const ids = result.data.map((a) => a.providerId);
    setMethods({ password: ids.includes("credential"), google: ids.includes("google") });
  }, [methods]);

  const signOutNow = useCallback(async () => {
    setSigningOut(true);
    const result = await signOut().catch(() => ({ error: { message: "network" } }));
    if (result && "error" in result && result.error) {
      setSigningOut(false);
      toast.error("Could not sign out. Check your connection and try again.");
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }, [router]);

  return { methods, loadMethods, signingOut, signOutNow };
}

/** "Signed in with Google and password" style line for the menu header. */
export function SignInMethodsLine({ methods }: { methods: SignInMethods }) {
  if (!methods) return null;
  const parts = [methods.google ? "Google" : null, methods.password ? "password" : null].filter(Boolean);
  if (!parts.length) return null;
  return <span className="block text-[11px] text-muted-foreground">Signs in with {parts.join(" and ")}</span>;
}

/** Team members and roles (for those whose role opens them), change password (only for accounts that have one) and log out. */
export function AccountMenuItems({
  account,
  onChangePassword,
}: {
  account: ReturnType<typeof useAccount>;
  onChangePassword: () => void;
}) {
  // While methods are loading, keep the item; hide it once we know the account has no password (Google only).
  const canChangePassword = account.methods?.password !== false;
  const canSeeTeam = useCan("settings.team:view");
  const canSeeRoles = useCan("settings.roles:view");
  return (
    <>
      <DropdownMenuGroup>
        {canSeeTeam ? (
          <DropdownMenuItem asChild>
            <Link href="/settings/team">
              <Users />
              Team members
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canSeeRoles ? (
          <DropdownMenuItem asChild>
            <Link href="/settings/roles">
              <ShieldCheck />
              Roles and permissions
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canChangePassword ? (
          <DropdownMenuItem onSelect={onChangePassword}>
            <KeyRound />
            Change password
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        disabled={account.signingOut}
        onSelect={(event) => {
          // Keep the menu open so the spinner shows until the redirect.
          event.preventDefault();
          void account.signOutNow();
        }}
      >
        {account.signingOut ? <Spinner /> : <LogOut />}
        {account.signingOut ? "Logging out…" : "Log out"}
      </DropdownMenuItem>
    </>
  );
}
