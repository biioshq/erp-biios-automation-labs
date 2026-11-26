"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { findActive } from "@/config/navigation";

type Crumb = { title: string; href: string; className?: string };

/**
 * Module › section › page, from the navigation config. A tab page shows its
 * sidebar entry too (Finance › Expenses › Recurring expenses); detail pages
 * add "Details" after the page they belong to.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const { module, item, child, page: subPage } = findActive(pathname);
  if (!module) {
    const title = pathname.startsWith("/settings") ? "Settings" : "";
    return title ? <span className="block truncate text-sm font-medium">{title}</span> : null;
  }

  const isDashboard = !item || (item.exact && item.href === module.href);
  // The page the path belongs to: the tab when the entry has tabs, else the entry.
  const page = child ?? item;
  // A sub-page (Fixed assets › Depreciation on assets) is a page of its own, not a detail page.
  const sub = subPage && page && subPage.href !== page.href ? subPage : null;
  const isDetail = Boolean(page && pathname !== (sub ?? page).href);

  const trail: Crumb[] = [{ title: module.title, href: module.href }];
  if (isDashboard || !item || !page) {
    trail.push({ title: "Dashboard", href: module.href });
  } else {
    // A tab that shares its entry's href is the entry's own page, so the entry crumb is left out
    // and the page shows under its own title (Inventory › All items). Narrow screens drop the
    // entry crumb to keep the page name in view.
    if (child && child.href !== item.href) trail.push({ title: item.title, href: item.href, className: "hidden md:inline-flex" });
    trail.push({ title: page.title, href: page.href });
    if (sub) trail.push({ title: sub.title, href: sub.href });
  }
  if (isDetail) trail.push({ title: "Details", href: pathname });

  // Phones: just the page title (the page a detail page belongs to), truncated.
  const current = trail[trail.length - (isDetail ? 2 : 1)].title;
  return (
    <>
      <span className="block truncate text-[15px] font-medium text-foreground sm:hidden">{current}</span>
      <Breadcrumb className="hidden sm:block">
        <BreadcrumbList className="flex-nowrap">
          {trail.map((crumb, i) => {
            const last = i === trail.length - 1;
            return (
              <Fragment key={`${i}:${crumb.href}`}>
                {i > 0 ? <BreadcrumbSeparator className={crumb.className} /> : null}
                <BreadcrumbItem className={crumb.className}>
                  {last ? (
                    <BreadcrumbPage className="truncate">{crumb.title}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href} className="whitespace-nowrap">
                        {crumb.title}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
