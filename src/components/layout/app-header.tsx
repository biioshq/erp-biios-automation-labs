import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BiiosSymbol } from "@/components/brand/logo";
import { Breadcrumbs } from "./breadcrumbs";
import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";
import { ProfileMenu } from "./profile-menu";
import { NotificationsMenu } from "@/features/notifications/components/notifications-menu";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-1 border-b bg-background/85 px-[max(0.5rem,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pr-[max(0.5rem,env(safe-area-inset-right))] backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:gap-1.5 md:px-4 lg:gap-2 lg:rounded-t-xl">
      <SidebarTrigger className="size-10 shrink-0 md:size-9 lg:-ml-1 lg:size-7" />
      {/* Phones and tablets: the sidebar is a drawer, so the symbol marks the app here. */}
      <Link href="/" aria-label="Biios Project Manager" className="mr-1 shrink-0 lg:hidden">
        <BiiosSymbol ground="light" size={28} className="dark:hidden" />
        <BiiosSymbol ground="dark" size={28} className="hidden dark:block" />
      </Link>
      <Separator orientation="vertical" className="mr-1 hidden data-[orientation=vertical]:h-4 lg:block" />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Breadcrumbs />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <CommandMenu />
        <NotificationsMenu />
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
