import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { SectionTabs } from "@/components/layout/section-tabs";
import { CurrentUserProvider } from "@/components/current-user";
import { requireUser } from "@/server/auth/session";
import { LiveUpdates } from "@/components/live-updates";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Role and permissions are read fresh for every request, so a change applies on the next page.
  const user = await requireUser();
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <CurrentUserProvider user={user}>
      <LiveUpdates />
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar user={user} />
        <SidebarInset className="min-w-0 lg:peer-data-[variant=inset]:shadow-card">
          <AppHeader />
          {/* Tabs for the pages under the current sidebar entry; nothing on other pages. */}
          <SectionTabs />
          <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </CurrentUserProvider>
  );
}
