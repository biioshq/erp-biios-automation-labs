"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BiiosStacked, BiiosSymbol, PRODUCT_NAME } from "@/components/brand/logo";
import { MODULES, findActive } from "@/config/navigation";
import { UserMenu } from "./user-menu";
import type { SessionUser } from "@/server/auth/session";

export function AppSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  const closeOnMobile = () => isMobile && setOpenMobile(false);
  // One entry lights up: the one the page belongs to, including its tab pages and detail pages.
  const activeItem = findActive(pathname).item;

  // The drawer (phones and tablets) closes on every navigation, however it was triggered.
  React.useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-0 px-3 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <Link
          href="/finance"
          onClick={closeOnMobile}
          aria-label="Biios Project Manager, go to Finance"
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          {/* Expanded: stacked lockup at its 72px minimum. Collapsed: the symbol. */}
          <span className="block px-1.5 py-1 group-data-[collapsible=icon]:hidden">
            <BiiosStacked ground="dark" height={72} />
          </span>
          <span className="hidden justify-center py-1 group-data-[collapsible=icon]:flex">
            <BiiosSymbol ground="dark" size={28} />
          </span>
        </Link>
        {/* The product name sits apart from the logo: the brand guide allows no descriptor on the logo itself. */}
        <div className="mt-4 flex items-center gap-2 border-t border-sidebar-border px-1.5 pt-3 group-data-[collapsible=icon]:hidden">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          <span className="text-[12px] font-medium tracking-[0.14em] text-sidebar-foreground/80 uppercase">{PRODUCT_NAME}</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[11.5px] font-medium tracking-[0.14em] text-sidebar-foreground/55 uppercase">Workspace</SidebarGroupLabel>
          <SidebarMenu className="gap-1">
            {MODULES.map((mod) => {
              const inModule = pathname === mod.href || pathname.startsWith(`${mod.href}/`);
              return (
                <Collapsible key={mod.id} asChild defaultOpen={inModule || mod.id === "finance"} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip={mod.title} isActive={inModule} className="h-9 font-medium max-lg:h-11">
                        <mod.icon className={inModule ? "text-brand-ink" : undefined} />
                        <span>{mod.title}</span>
                        <ChevronRight className="ml-auto size-3.5 opacity-60 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
                      <SidebarMenuSub className="mr-0 gap-0.5 py-1 pr-0">
                        {mod.items.map((item) => {
                          const active = item === activeItem;
                          return (
                            <SidebarMenuSubItem key={item.href}>
                              <SidebarMenuSubButton asChild isActive={active} className="h-8 data-active:shadow-[inset_2px_0_0_var(--brand)] max-lg:h-10">
                                <Link href={item.href} onClick={closeOnMobile} prefetch>
                                  <item.icon className="opacity-70" />
                                  <span>{item.title}</span>
                                  {active ? (
                                    <span aria-hidden className="ml-auto size-1.5 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />
                                  ) : null}
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <UserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
