"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { Transaction } from "../types";

/** The latest income and expenses in one list, newest first. */
export function RecentTransactions({ items }: { items: Transaction[] }) {
  if (!items.length) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No transactions yet"
        description="Expenses and income show up here as soon as you record them."
        action={
          <div className="flex flex-wrap justify-center gap-3 text-sm font-medium">
            <Link href="/finance/expenses?new=1" className="text-brand-ink hover:underline">
              Add expense
            </Link>
            <Link href="/finance/income?new=1" className="text-brand-ink hover:underline">
              Record income
            </Link>
          </div>
        }
      />
    );
  }
  return (
    <ul className="-mx-2 divide-y">
      {items.map((t, i) => {
        const income = t.direction === "income";
        const category = t.categoryLabel;
        return (
          <motion.li key={`${t.direction}-${t.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.03 }}>
            <Link
              href={t.href}
              scroll={false}
              className="flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", income ? "bg-success/12 text-success" : "bg-danger/10 text-danger")}>
                {income ? <ArrowDownLeft className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
                <span className="sr-only">{income ? "Income" : "Expense"}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.party}</p>
                <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <span className="shrink-0">{category}</span>
                  {t.project ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: t.project.color }} aria-hidden />
                      <span className="truncate">{t.project.name}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("tabular text-sm font-semibold", income ? "text-success" : "text-foreground")}>
                  {income ? "+" : "-"}
                  <Money value={t.amount} />
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(t.date)}</p>
              </div>
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}
