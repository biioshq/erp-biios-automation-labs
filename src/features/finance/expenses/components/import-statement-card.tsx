import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The first thing on Total expenses: importing a bank statement records most expenses, receipts and
 * payments in one go. The page shows it only to people who may upload a statement.
 */
export function ImportStatementCard() {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand/6 p-4 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/14 text-brand-ink">
        <Landmark className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Import a bank statement</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Upload a PDF, CSV or Excel statement. Withdrawals become expenses or settle bills you owe, deposits become income, and you check every line
          before it is saved.
        </p>
      </div>
      <Button asChild className="shrink-0 max-sm:w-full">
        <Link href="/finance/bank-statements">
          Import a statement <ArrowRight />
        </Link>
      </Button>
    </section>
  );
}
