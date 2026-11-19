"use client";

import { useRouter } from "next/navigation";
import { FileSpreadsheet, FileText, FileType } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportType } from "@/lib/constants";
import { reportHref } from "../schemas";
import type { ReportFilters } from "../types";

/** PDF, Excel and CSV downloads for a report with the current filters. */
export function DownloadButtons({
  type,
  filters,
  disabled,
  refreshOnDownload = true,
}: {
  type: ReportType;
  filters: Partial<ReportFilters>;
  disabled?: boolean;
  /** Re-reads the page shortly after a download so the export history shows it. */
  refreshOnDownload?: boolean;
}) {
  const router = useRouter();
  const onClick = () => {
    if (refreshOnDownload) window.setTimeout(() => router.refresh(), 2500);
  };
  const buttons = [
    { format: "pdf", label: "PDF", icon: FileText, primary: true },
    { format: "xlsx", label: "Excel", icon: FileSpreadsheet },
    { format: "csv", label: "CSV", icon: FileType },
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Download report">
      {buttons.map((b) => (
        <Button key={b.format} asChild variant={"primary" in b ? "default" : "outline"} size="sm" className="h-8" aria-disabled={disabled}>
          <a
            href={disabled ? undefined : reportHref(type, b.format, filters)}
            download
            onClick={disabled ? (e) => e.preventDefault() : onClick}
            className={disabled ? "pointer-events-none opacity-50" : undefined}
          >
            <b.icon /> {b.label}
          </a>
        </Button>
      ))}
    </div>
  );
}
