import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Money } from "@/components/shared/money";
import { BUILT_IN_GROUPS } from "@/lib/finance-groups";
import type { StatementLine } from "@/lib/accounting";

/** Pages that hold each asset group's records. Groups without one show without a link. */
const GROUP_PAGES: Record<string, string> = {
  inventory: "/finance/assets/inventory",
  cash_equivalents: "/finance/assets/cash",
  receivables: "/finance/assets/receivables",
  prepaid: "/finance/assets/prepaid",
  fixed_assets: "/finance/assets/fixed",
  intangible_assets: "/finance/assets/intangible",
  long_term_investments: "/finance/assets/investments",
  other_current_assets: "/finance/assets/fixed",
  other_long_term_assets: "/finance/assets/fixed",
};

/** Groups always listed, even at zero, so every asset page is one click away. */
const ALWAYS = new Set(["inventory", "cash_equivalents", "receivables", "prepaid", "fixed_assets", "intangible_assets", "long_term_investments"]);

/**
 * One side of the balance sheet's assets (current or non-current): each group with its amount
 * and the child lines the engine gives (accounts, subgroups), linking to the group's page.
 */
export function AssetLines({ root, lines, total, totalLabel }: { root: "current_assets" | "non_current_assets"; lines: StatementLine[]; total: number; totalLabel: string }) {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const builtIns = BUILT_IN_GROUPS.filter((g) => g.parent === root);
  const shown: StatementLine[] = [
    ...builtIns.flatMap((g) => {
      const line = byKey.get(g.key);
      if (line) return [line];
      return ALWAYS.has(g.key) ? [{ key: g.key, label: g.label, amount: 0 }] : [];
    }),
    // A top-level subgroup an admin added directly under current or non-current assets.
    ...lines.filter((l) => !builtIns.some((g) => g.key === l.key)),
  ];

  return (
    <div className="divide-y">
      {shown.map((line) => {
        const href = GROUP_PAGES[line.key] ?? line.href;
        const children = line.children ?? [];
        return (
          <div key={line.key} className="py-2.5 first:pt-0">
            {href ? (
              <Link href={href} className="group flex items-center justify-between gap-3 rounded-md py-1 text-sm hover:text-brand-ink">
                <span className="flex min-w-0 items-center gap-1 font-medium">
                  <span className="truncate">{line.label}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <Money value={line.amount} tone="auto" className="font-semibold" />
              </Link>
            ) : (
              <div className="flex items-center justify-between gap-3 py-1 text-sm">
                <span className="truncate font-medium">{line.label}</span>
                <Money value={line.amount} tone="auto" className="font-semibold" />
              </div>
            )}
            {children.length ? (
              <ul className="mt-1 space-y-1 border-l pl-3">
                {children.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{c.label}</span>
                    <Money value={c.amount} tone="auto" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3 pt-3 text-sm font-semibold">
        <span>{totalLabel}</span>
        <Money value={total} tone="auto" />
      </div>
    </div>
  );
}
