"use client";

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

/** Module › page, from the navigation config. Detail pages show the page they belong to. */
export function Breadcrumbs() {
  const pathname = usePathname();
  const { module, item } = findActive(pathname);
  if (!module) {
    const title = pathname.startsWith("/settings") ? "Settings" : "";
    return title ? <span className="block truncate text-sm font-medium">{title}</span> : null;
  }
  const isDetail = item && pathname !== item.href;
  const current = item && !(item.exact && item.href === module.href) ? item.title : "Dashboard";
  return (
    <>
      {/* Phones: just the page title, truncated. */}
      <span className="block truncate text-[15px] font-medium text-foreground sm:hidden">{current}</span>
      <Breadcrumb className="hidden sm:block">
        <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="hidden sm:inline-flex">
          <BreadcrumbLink asChild>
            <Link href={module.href}>{module.title}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {item && !(item.exact && item.href === module.href) ? (
          <>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              {isDetail ? (
                <BreadcrumbLink asChild>
                  <Link href={item.href}>{item.title}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.title}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        ) : (
          <>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage>Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
        {isDetail ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Details</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
        </BreadcrumbList>
      </Breadcrumb>
    </>
  );
}
