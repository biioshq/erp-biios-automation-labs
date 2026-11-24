import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { BANK_LINE_ACTIONS, labelOf, type BankLineAction } from "@/lib/constants";
import type { BalanceCheck } from "../types";

const CHECKS: Record<BalanceCheck, { tone: Tone; label: string; title: string }> = {
  ok: { tone: "success", label: "Balance OK", title: "The running balance confirms this line to the paisa" },
  fixed: { tone: "warning", label: "Side fixed", title: "The balance showed the amount was on the other side; it was turned round" },
  mismatch: { tone: "danger", label: "Balance off", title: "The balance does not follow from the line before" },
  unchecked: { tone: "neutral", label: "Not checked", title: "No balance to check this line against" },
};

/** How the running balance confirmed the line's side. */
export function CheckBadge({ check }: { check: BalanceCheck }) {
  const c = CHECKS[check];
  return (
    <span title={c.title}>
      <StatusBadge tone={c.tone}>{c.label}</StatusBadge>
    </span>
  );
}

const ACTION_TONES: Record<BankLineAction, Tone> = {
  match: "info",
  expense: "danger",
  income: "success",
  capital: "violet",
  drawing: "violet",
  loan_received: "brand",
  loan_payment: "brand",
  transfer: "neutral",
  ignore: "neutral",
};

export function ActionBadge({ action }: { action: BankLineAction }) {
  return (
    <StatusBadge tone={ACTION_TONES[action]} dot={false}>
      {labelOf(BANK_LINE_ACTIONS, action)}
    </StatusBadge>
  );
}
