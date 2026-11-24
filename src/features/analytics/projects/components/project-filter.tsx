import { ParamSelect } from "@/features/analytics/inventory/components/controls";
import type { ProjectStatus } from "@/lib/constants";
import { STATUS_FILTER_OPTIONS, statusFilterValue } from "../model";

/** The status filter (?status=) shared by the project analytics pages. */
export function ProjectStatusSelect({ statuses }: { statuses: ProjectStatus[] | null }) {
  return <ParamSelect name="status" value={statusFilterValue(statuses)} fallback="all" label="Filter by status" options={STATUS_FILTER_OPTIONS} className="sm:min-w-64" />;
}

/** Picks one project (?project=) for a detail section. */
export function ProjectPicker({ value, options, fallback }: { value: string; options: { value: string; label: string }[]; fallback: string }) {
  return <ParamSelect name="project" value={value} fallback={fallback} label="Project" options={options} className="sm:min-w-64" />;
}
