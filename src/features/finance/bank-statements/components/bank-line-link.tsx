"use client";

import Link from "next/link";
import { Landmark } from "lucide-react";
import { useCan } from "@/components/current-user";
import { cn } from "@/lib/utils";
import { bankLineHref } from "../line-href";

/**
 * A link to the bank statement line a record is matched to, where it can be unmatched.
 * Shown only to people who can open bank statements.
 */
export function BankLineLink({ id, label = "Open the statement line", className }: { id: string | null | undefined; label?: string; className?: string }) {
  const canOpen = useCan("finance.bank_statements:view");
  if (!id || !canOpen) return null;
  return (
    <Link href={bankLineHref(id)} className={cn("inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline", className)}>
      <Landmark className="size-3 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
