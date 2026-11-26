"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSectionTabs } from "@/config/navigation";
import { useCanFn } from "@/components/current-user";
import { cn } from "@/lib/utils";

/**
 * The pages under a sidebar entry (Expenses and Recurring, the task statuses …)
 * that the person's role opens, as a tab row above the page. It renders nothing on pages without tabs and on
 * detail pages. The row lines up with the page body and scrolls sideways inside
 * itself on narrow screens, keeping the active tab in view.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const can = useCanFn();
  const section = getSectionTabs(pathname, can);
  const activeHref = section?.activeHref;

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current]");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [activeHref]);

  if (!section) return null;

  const tabClass = (active: boolean) =>
    cn(
      "relative -mb-px flex h-10 items-center rounded-t-md border-b-2 px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset max-md:h-11 sm:px-3.5",
      active ? "border-brand-ink font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
    );
  const subTabs = section.subTabs.length > 1 ? section.subTabs : [];

  // Same width and side padding as the page body (components/shared/page.tsx), so the tabs line up with its content.
  return (
    <div className="mx-auto w-full max-w-[1480px] shrink-0 px-4 pt-2 sm:pt-3 md:px-6 lg:px-8 lg:pt-4">
      {section.tabs.length ? (
        <nav ref={navRef} aria-label={`${section.item.title} pages`} className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex w-max min-w-full gap-1 border-b">
            {section.tabs.map((tab) => {
              const active = tab.href === section.activeHref;
              return (
                <li key={tab.href} className="shrink-0">
                  <Link href={tab.href} aria-current={active && !subTabs.length ? "page" : active ? "true" : undefined} className={tabClass(active)}>
                    {tab.tab ?? tab.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
      {subTabs.length ? (
        // The pages inside this one (Asset register, Depreciation on assets), reached only from here.
        <nav aria-label={`Inside ${section.tabs.find((t) => t.href === section.activeHref)?.title ?? section.item.title}`} className="mt-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex w-max gap-1 rounded-lg border bg-muted/40 p-1">
            {subTabs.map((tab) => {
              const active = tab.href === (section.activeSubHref ?? subTabs[0].href);
              return (
                <li key={tab.href} className="shrink-0">
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-10",
                      active ? "bg-card font-semibold text-foreground shadow-sm" : "font-medium text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.tab ?? tab.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
