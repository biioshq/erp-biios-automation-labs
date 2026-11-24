/** The tabs of Payment tracking (/finance/payments). Client-safe. */

export const PAYMENT_TABS = [
  { value: "unpaid", label: "Unpaid", hint: "Nothing paid yet, not past due" },
  { value: "partial", label: "Partly paid", hint: "Part paid, the rest not past due" },
  { value: "upcoming", label: "Due in 30 days", hint: "Unpaid or part paid, due today or in the next 30 days" },
  { value: "overdue", label: "Overdue", hint: "Past the due date with something still owed" },
  { value: "paid", label: "Paid", hint: "Nothing left to pay" },
  { value: "history", label: "Payment history", hint: "Every payment recorded against an expense" },
] as const;
export type PaymentTab = (typeof PAYMENT_TABS)[number]["value"];

export function parsePaymentTab(value: string | string[] | undefined): PaymentTab {
  const v = Array.isArray(value) ? value[0] : value;
  return PAYMENT_TABS.some((t) => t.value === v) ? (v as PaymentTab) : "unpaid";
}
