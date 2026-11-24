"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROJECT_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Groups offered besides single statuses: open work, and finished work. */
const GROUPS = [
  { value: "open", label: "Open (planning, active, on hold)", statuses: "planning,active,on_hold" },
  { value: "closed", label: "Closed (completed, cancelled)", statuses: "completed,cancelled" },
] as const;

/** Writes ?status= (a comma list) and lets the server filter the projects. */
export function ProjectStatusFilter({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const raw = searchParams.get("status") ?? "";
  const value = raw === "" ? "all" : (GROUPS.find((g) => g.statuses === raw)?.value ?? raw);

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    const group = GROUPS.find((g) => g.value === next);
    if (next === "all") params.delete("status");
    else params.set("status", group ? group.statuses : next);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger className={cn("h-9 w-full sm:w-64", pending && "opacity-60", className)} aria-label="Filter by status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        {GROUPS.map((g) => (
          <SelectItem key={g.value} value={g.value}>
            {g.label}
          </SelectItem>
        ))}
        {PROJECT_STATUSES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

