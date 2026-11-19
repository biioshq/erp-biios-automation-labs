"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** A history row's download link. Like the download buttons, it re-reads the page shortly after, so the new export is listed. */
export function DownloadAgainLink({
  href,
  label,
  variant,
  className,
  children,
}: {
  href: string;
  label: string;
  variant: "outline" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Button asChild variant={variant} size="sm" className={className}>
      <a href={href} download aria-label={label} onClick={() => window.setTimeout(() => router.refresh(), 2500)}>
        {children}
      </a>
    </Button>
  );
}
