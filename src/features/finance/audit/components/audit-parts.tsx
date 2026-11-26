import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import type { AuditAction, AuditChangeView } from "@/lib/audit";

/** Small pieces shared by the Audit trail page and the History sections. */

const ACTION_TONES: Partial<Record<AuditAction, Tone>> = {
  created: "success",
  imported: "info",
  edited: "neutral",
  categorised: "violet",
  deleted: "danger",
  paid: "success",
  payment_removed: "warning",
  matched: "info",
  unmatched: "warning",
  cancelled: "danger",
  restored: "neutral",
  rule_changed: "brand",
};

export function AuditActionBadge({ action, label }: { action: AuditAction; label: string }) {
  return (
    <StatusBadge tone={ACTION_TONES[action] ?? "neutral"} dot={false} className="h-5 px-2 text-[11px] whitespace-nowrap">
      {label}
    </StatusBadge>
  );
}

/** "Amount: 1,200.00 to 1,500.00", one line per field. A new record shows only its values. */
export function AuditChanges({ changes, className }: { changes: AuditChangeView[]; className?: string }) {
  if (!changes.length) return null;
  return (
    <ul className={className ?? "space-y-0.5 text-xs"}>
      {changes.map((c) => (
        <li key={c.field} className="min-w-0 break-words">
          <span className="text-muted-foreground">{c.label}: </span>
          {c.from !== null && c.to !== null ? (
            <>
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">{c.from}</span>
              <span className="text-muted-foreground"> to </span>
              <span className="font-medium">{c.to}</span>
            </>
          ) : c.to !== null ? (
            <span className="font-medium">{c.to}</span>
          ) : c.from !== null ? (
            <>
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">{c.from}</span>
              <span className="text-muted-foreground"> (removed)</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
