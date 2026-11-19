import { AlertTriangle, CircleCheck, CircleX } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/format";
import { STOCK_STATUS_META } from "@/lib/stock-status";
import type { StockStatus } from "@/lib/constants";

const ROWS: { status: StockStatus; icon: typeof CircleCheck; bar: string; text: string }[] = [
  { status: "in_stock", icon: CircleCheck, bar: "bg-success", text: "text-success" },
  { status: "low_stock", icon: AlertTriangle, bar: "bg-warning", text: "text-warning" },
  { status: "out_of_stock", icon: CircleX, bar: "bg-danger", text: "text-danger" },
];

/** Share of items by stock status: a segmented bar with a labelled legend (colour is never the only cue). */
export function StatusMix({ counts }: { counts: Record<StockStatus, number> }) {
  const total = ROWS.reduce((s, r) => s + counts[r.status], 0);
  return (
    <div className="space-y-5">
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={ROWS.map((r) => `${STOCK_STATUS_META[r.status].label}: ${counts[r.status]}`).join(", ")}
      >
        {total > 0
          ? ROWS.filter((r) => counts[r.status] > 0).map((r) => (
              <div key={r.status} className={r.bar} style={{ width: `${(counts[r.status] / total) * 100}%` }} />
            ))
          : null}
      </div>
      <ul className="space-y-3">
        {ROWS.map((r) => (
          <li key={r.status} className="flex items-center gap-3 text-sm">
            <r.icon className={`size-4 shrink-0 ${r.text}`} />
            <span className="flex-1">{STOCK_STATUS_META[r.status].label}</span>
            <span className="tabular font-semibold">{formatNumber(counts[r.status])}</span>
            <span className="tabular w-14 text-right text-xs text-muted-foreground">{total ? formatPercent(counts[r.status] / total) : "0%"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
