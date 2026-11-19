import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { CurrentUserProvider } from "@/components/current-user";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <CurrentUserProvider user={user}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar user={user} />
        <SidebarInset className="min-w-0 lg:peer-data-[variant=inset]:shadow-card">
          <AppHeader />
          <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </CurrentUserProvider>
  );
}
