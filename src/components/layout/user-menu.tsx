"use client";

import { useTheme } from "next-themes";
import { useState } from "react";
import { ChevronsUpDown, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import type { SessionUser } from "@/server/auth/session";
import { ChangePasswordDialog } from "./change-password-dialog";
import { AccountMenuItems, SignInMethodsLine, UserAvatar, useAccount } from "./account";

export function UserMenu({ user }: { user: SessionUser }) {
  const { theme, setTheme } = useTheme();
  const { isMobile } = useSidebar();
  const account = useAccount();
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <SidebarMenu>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={(open) => open && void account.loadMethods()}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <UserAvatar user={user} className="size-8 rounded-lg" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 opacity-60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60" side={isMobile ? "top" : "right"} align="end" sideOffset={8}>
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-muted-foreground">
                {user.email} · {user.role === "admin" ? "Admin" : "Member"}
              </div>
              <SignInMethodsLine methods={account.methods} />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="eyebrow py-1">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon /> Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <AccountMenuItems account={account} onChangePassword={() => setPasswordOpen(true)} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
