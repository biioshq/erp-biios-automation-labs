"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { PROJECT_TABS, type ProjectTab } from "../schemas";

/**
 * Tab links driven by ?tab=. The row scrolls sideways inside itself on narrow
 * screens and keeps the active tab in view, including after a reload.
 */
export function ProjectTabsNav({ tab }: { tab: ProjectTab }) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current='page']");
    if (!nav || !active) return;
    const left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [tab]);

  return (
    <nav ref={navRef} aria-label="Project sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
      <ul className="relative flex w-max min-w-full gap-1 border-b">
        {PROJECT_TABS.map((t) => {
          const active = t.value === tab;
          return (
            <li key={t.value}>
              <Link
                href={`?tab=${t.value}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "relative -mb-px block border-b-2 border-brand-ink px-3.5 py-3 text-sm font-semibold whitespace-nowrap text-foreground"
                    : "relative -mb-px block border-b-2 border-transparent px-3.5 py-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
