"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/current-user";

/** Opens the new-task drawer without losing the current view, filters or month. */
export function NewTaskButton() {
  const pathname = usePathname();
  const params = new URLSearchParams(useSearchParams().toString());
  const canCreate = useCan("tasks.tasks:create");
  params.delete("task");
  params.delete("edit");
  params.set("new", "1");
  if (!canCreate) return null;
  return (
    <Button asChild className="max-sm:w-full">
      <Link href={`${pathname}?${params.toString()}`} scroll={false}>
        <Plus /> New task
      </Link>
    </Button>
  );
}
