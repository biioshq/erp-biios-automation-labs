"use client";

import { EyeOff } from "lucide-react";
import { useCan } from "@/components/current-user";
import { cn } from "@/lib/utils";

/**
 * Shown next to project spend to people without "data.salaries": their figures leave out salary
 * expenses, so a project total never reveals one person's pay. People who may see salaries get
 * full figures and no note.
 */
export function SalariesHiddenNote({ className }: { className?: string }) {
  if (useCan("data.salaries")) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <EyeOff className="size-3.5 shrink-0" aria-hidden />
      Spend excludes salaries, which your role does not include.
    </p>
  );
}
