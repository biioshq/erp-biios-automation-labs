"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSectionTabs } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * The pages under a sidebar entry (Expenses and Recurring, the task statuses …)
 * as a tab row above the page. It renders nothing on pages without tabs and on
 * detail pages. The row lines up with the page body and scrolls sideways inside
 * itself on narrow screens, keeping the active tab in view.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const section = getSectionTabs(pathname);
  const activeHref = section?.activeHref;

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [activeHref]);

  if (!section) return null;

  // Same width and side padding as the page body (components/shared/page.tsx), so the tabs line up with its content.
  return (
    <nav
      ref={navRef}
      aria-label={`${section.item.title} pages`}
      className="mx-auto w-full max-w-[1480px] shrink-0 overflow-x-auto overflow-y-hidden px-4 pt-2 [scrollbar-width:none] sm:pt-3 md:px-6 lg:px-8 lg:pt-4 [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max min-w-full gap-1 border-b">
        {section.tabs.map((tab) => {
          const active = tab.href === section.activeHref;
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative -mb-px flex h-10 items-center rounded-t-md border-b-2 px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset max-md:h-11 sm:px-3.5",
                  active ? "border-brand-ink font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.tab ?? tab.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
