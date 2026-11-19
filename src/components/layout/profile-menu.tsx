"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/components/current-user";
import { AccountMenuItems, SignInMethodsLine, UserAvatar, useAccount } from "./account";
import { ChangePasswordDialog } from "./change-password-dialog";

/** Top-right profile dropdown: picture, name, email, account actions and log out. */
export function ProfileMenu() {
  const user = useCurrentUser();
  const account = useAccount();
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <DropdownMenu onOpenChange={(open) => open && void account.loadMethods()}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="ml-0.5 size-10 rounded-full p-0 md:size-9"
            aria-label={`Account: ${user.name}`}
          >
            <UserAvatar user={user} className="size-8 ring-1 ring-border md:size-7.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-[min(18rem,calc(100vw-1rem))]">
          <DropdownMenuLabel className="flex items-center gap-3 py-2.5 font-normal">
            <UserAvatar user={user} className="size-10" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {user.role === "admin" ? "Admin" : "Member"}
              </span>
              <SignInMethodsLine methods={account.methods} />
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <AccountMenuItems account={account} onChangePassword={() => setPasswordOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
