import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ASSET_CONDITIONS, DEPRECIATION_METHODS, labelOf, type AssetCondition, type DepreciationMethod } from "@/lib/constants";
import { formatNumber } from "@/lib/format";

const CONDITION_TONES: Record<AssetCondition, Tone> = {
  good: "success",
  under_maintenance: "warning",
  damaged: "danger",
  lost: "danger",
  disposed: "neutral",
};

export function ConditionBadge({ condition, className }: { condition: AssetCondition; className?: string }) {
  return (
    <StatusBadge tone={CONDITION_TONES[condition]} className={className}>
      {labelOf(ASSET_CONDITIONS, condition)}
    </StatusBadge>
  );
}

/** "Straight line, 5 yrs", "Written down value, 25% a year", "Not depreciated". */
export function methodText(method: DepreciationMethod, life: number, rate: number | null): string {
  if (method === "wdv") return `${labelOf(DEPRECIATION_METHODS, method)}, ${formatNumber(rate ?? 0)}% a year`;
  if (method === "slm") return `${labelOf(DEPRECIATION_METHODS, method)}, ${formatNumber(life)} ${life === 1 ? "yr" : "yrs"}`;
  return labelOf(DEPRECIATION_METHODS, method);
}
