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
import { MODULES, findActive, type NavItem } from "@/config/navigation";
import { UserMenu } from "./user-menu";
import type { SessionUser } from "@/server/auth/session";

export function AppSidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  const closeOnMobile = () => isMobile && setOpenMobile(false);
  // One entry lights up: the one the page belongs to, including its tab pages and detail pages.
  const { item: activeItem, child: activeChild } = findActive(pathname);

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
                        {mod.items.map((item) =>
                          item.children?.length ? (
                            <SubGroup key={item.href} item={item} active={item === activeItem} activeChild={activeItem === item ? activeChild : null} onNavigate={closeOnMobile} />
                          ) : (
                            <SidebarMenuSubItem key={item.href}>
                              <SidebarMenuSubButton asChild isActive={item === activeItem} className="h-8 data-active:shadow-[inset_2px_0_0_var(--brand)] max-lg:h-10">
                                <Link href={item.href} onClick={closeOnMobile} prefetch>
                                  <item.icon className="opacity-70" />
                                  <span>{item.title}</span>
                                  {item === activeItem ? <ActiveDot /> : null}
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ),
                        )}
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

function ActiveDot() {
  return <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />;
}

/**
 * A sidebar entry with pages under it (Income, Expenses, Assets...): its name opens its first page,
 * the chevron folds its pages away. It starts open when one of its pages is showing.
 */
function SubGroup({ item, active, activeChild, onNavigate }: { item: NavItem; active: boolean; activeChild: NavItem | null; onNavigate: () => void }) {
  const [open, setOpen] = React.useState(active);
  // Opening a page of this group (from anywhere) unfolds it: adjusted while rendering, not in an effect.
  const [wasActive, setWasActive] = React.useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setOpen(true);
  }
  const listId = React.useId();
  return (
    <SidebarMenuSubItem>
      <div className="flex items-center">
        <SidebarMenuSubButton asChild isActive={active && !open} className="h-8 min-w-0 flex-1 data-active:shadow-[inset_2px_0_0_var(--brand)] max-lg:h-10">
          <Link href={item.href} onClick={onNavigate} prefetch>
            <item.icon className="opacity-70" />
            <span className={active ? "font-medium" : undefined}>{item.title}</span>
          </Link>
        </SidebarMenuSubButton>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`${open ? "Hide" : "Show"} ${item.title} pages`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring max-lg:size-10"
        >
          <ChevronRight className={`size-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
      </div>
      {open ? (
        <ul id={listId} className="mt-0.5 ml-3.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2">
          {item.children!.map((child) => {
            const isActive = active && activeChild?.href === child.href;
            return (
              <li key={child.href}>
                <SidebarMenuSubButton asChild size="sm" isActive={isActive} className="h-7 data-active:shadow-[inset_2px_0_0_var(--brand)] max-lg:h-9">
                  <Link href={child.href} onClick={onNavigate} prefetch={false}>
                    <span className="truncate">{child.tab ?? child.title}</span>
                    {isActive ? <ActiveDot /> : null}
                  </Link>
                </SidebarMenuSubButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </SidebarMenuSubItem>
  );
}
