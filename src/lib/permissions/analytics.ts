import type { PermissionResource } from "./types";

/**
 * Analytics & Planning. Member defaults match what a member could do before roles existed:
 * every analytics page was open to members; members could create, edit, duplicate, recalculate
 * and export scenarios and comparisons; only admins could approve or reject a scenario (or move
 * one out of a decision), delete a scenario, or store this month's forecasts by hand.
 */
export const ANALYTICS_RESOURCES: PermissionResource[] = [
  {
    key: "analytics.dashboard",
    module: "analytics",
    group: "Analytics & Planning",
    label: "Analytics dashboard",
    description: "Risk cards and trend charts. Each card shows only when the page it comes from can be opened.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "analytics.scenarios",
    module: "analytics",
    group: "Analytics & Planning",
    label: "What-if scenarios",
    description: "Create covers new and duplicated scenarios. Edit covers changes, status moves other than decisions, and updating saved results. Approve covers approving, rejecting and reopening a decided scenario, and any other status move.",
    actions: ["view", "create", "edit", "delete", "export", "approve"],
    memberDefault: ["view", "create", "edit", "export"],
  },
  {
    key: "analytics.forecasting",
    module: "analytics",
    group: "Analytics & Planning",
    label: "Forecasting",
    description: "Demand, purchase, project cost, consumption, maintenance and manpower forecasts, and forecast vs actual. Create stores this month's forecasts by hand.",
    actions: ["view", "create"],
    memberDefault: ["view"],
  },
  {
    key: "analytics.compare",
    module: "analytics",
    group: "Analytics & Planning",
    label: "Compare scenarios and scenario history",
    description: "Both pages show scenario results, so they also need the What-if scenarios view permission.",
    actions: ["view", "export"],
    memberDefault: ["view", "export"],
  },
  {
    key: "analytics.inventory",
    module: "analytics",
    group: "Analytics & Planning",
    label: "Inventory analytics",
    description: "Stock movement, fast and slow moving, ageing, levels, consumption trends and shortage risk.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "analytics.projects",
    module: "analytics",
    group: "Analytics & Planning",
    label: "Project analytics",
    description: "Project cost, budget vs actual, resource use, cost overruns and performance.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "analytics.insights",
    module: "analytics",
    group: "Analytics & Planning",
    label: "Management insights",
    description: "Business, financial, procurement, vendor and efficiency insights. Profit and cash figures also need the financial position permission.",
    actions: ["view"],
    memberDefault: ["view"],
  },
];
