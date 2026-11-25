"use client";

import { Download, FileSpreadsheet, FileType } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Excel or CSV download of the month's register (the same grid as the page). */
export function RegisterDownload({ month, label }: { month: string; label: string }) {
  const href = (format: "xlsx" | "csv") => `/api/hr/attendance/export?${new URLSearchParams({ month, format }).toString()}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <Download className="opacity-70" /> Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs">Register for {label}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={href("xlsx")} download>
            <FileSpreadsheet /> Excel (.xlsx)
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href("csv")} download>
            <FileType /> CSV
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
