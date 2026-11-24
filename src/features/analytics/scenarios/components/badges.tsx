import type { LucideIcon } from "lucide-react";
import { CalendarClock, FolderPlus, IndianRupee, PackageSearch, Truck, Users, Wrench } from "lucide-react";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { SCENARIO_STATUSES, SCENARIO_TYPES, labelOf, type ScenarioStatus, type ScenarioType } from "@/lib/constants";

/** What each scenario type answers, for the type picker and headers. */
export const SCENARIO_TYPE_META: Record<ScenarioType, { icon: LucideIcon; summary: string }> = {
  demand: { icon: PackageSearch, summary: "Material needs go up or down on some projects. See what stock covers, what to buy and what it does to budgets." },
  supply_delay: { icon: Truck, summary: "A delivery arrives late. See when stock runs out, which projects could slip and what bridging stock costs." },
  new_project: { icon: FolderPlus, summary: "Plan a project that does not exist yet against the stock, equipment, people and cash on record. Nothing is created." },
  price: { icon: IndianRupee, summary: "A material gets dearer or cheaper. See the extra spend or savings on projects and on this year's purchases." },
  budget: { icon: CalendarClock, summary: "Change a project, department or company budget and see expected spend, what is left and where it may run over." },
  manpower: { icon: Users, summary: "Need more or fewer people on a project or in a department. See who is free, who to hire and the cost." },
  equipment: { icon: Wrench, summary: "A project needs equipment for a period. See what is free, what is with other projects and the cost of the rest." },
};

export const STATUS_TONES: Record<ScenarioStatus, Tone> = {
  draft: "neutral",
  saved: "info",
  under_review: "warning",
  approved: "success",
  rejected: "danger",
  archived: "neutral",
};

export function ScenarioStatusBadge({ status, className }: { status: ScenarioStatus; className?: string }) {
  return (
    <StatusBadge tone={STATUS_TONES[status]} className={className}>
      {labelOf(SCENARIO_STATUSES, status)}
    </StatusBadge>
  );
}

export function ScenarioTypeBadge({ type, className }: { type: ScenarioType; className?: string }) {
  const Icon = SCENARIO_TYPE_META[type].icon;
  return (
    <StatusBadge tone="brand" dot={false} icon={<Icon className="size-3" aria-hidden />} className={className}>
      {labelOf(SCENARIO_TYPES, type)}
    </StatusBadge>
  );
}
