"use client";

import { EyeOff } from "lucide-react";
import { useIsAdmin } from "@/components/current-user";
import { cn } from "@/lib/utils";

/**
 * Shown to members next to project spend: their figures leave out salary expenses, so a
 * project total never reveals one person's pay. Admins see full figures and no note.
 */
export function SalariesHiddenNote({ className }: { className?: string }) {
  if (useIsAdmin()) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <EyeOff className="size-3.5 shrink-0" aria-hidden />
      Spend excludes salaries, which only admins can see.
    </p>
  );
}
