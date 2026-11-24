import Link from "next/link";
import { Money } from "@/components/shared/money";
import type { OverpaidInvoice } from "../queries";

/**
 * Invoices that received more than their total. Nothing is owed on them, so they are not among the
 * open invoices; the extra is money the customer paid ahead, held in the books as a customer advance.
 */
export function OverpaidInvoices({ rows }: { rows: OverpaidInvoice[] }) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.credit, 0);
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        Includes <Money value={total} /> received above the total of {rows.length === 1 ? "an invoice" : `${rows.length} invoices`}:
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 text-xs">
            <Link href={`/finance/invoices?view=${r.id}`} className="min-w-0 hover:underline">
              <span className="font-mono">{r.number}</span>
              <span className="text-muted-foreground"> · {r.client}</span>
            </Link>
            <span className="shrink-0 text-right">
              <Money value={r.credit} className="font-medium" /> more than the total
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
