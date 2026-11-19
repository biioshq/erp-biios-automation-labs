import { Money } from "@/components/shared/money";

/**
 * Full rupee amount from sm up, lakh/crore shorthand on phones where two KPI
 * tiles share a row. The exact amount stays in the tooltip on the short form.
 */
export function ResponsiveMoney({ value, tone }: { value: number; tone?: "positive" | "negative" | "auto" }) {
  return (
    <>
      <Money value={value} compact tone={tone} className="sm:hidden" />
      <Money value={value} tone={tone} className="max-sm:hidden" />
    </>
  );
}
