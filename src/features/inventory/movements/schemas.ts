/** Filter and sort keys accepted in the URL of the movements list. Client-safe. */
export const MOVEMENT_FILTER_KEYS = ["type", "project", "item"] as const;
export const MOVEMENT_SORT_KEYS = ["date", "quantity", "totalCost"] as const;
