import type { ProjectStage } from "@/lib/constants";

type ProjectRef = { id: string; name: string; color: string };

/** A recent move of stock from one project to another. */
export type ProjectMoveRow = {
  id: string;
  date: string;
  item: { id: string; name: string; sku: string; unit: string };
  quantity: number;
  from: ProjectRef | null;
  to: ProjectRef | null;
  stage: ProjectStage | null;
  /** Cost moved with the units: credited to the first project, charged to the second. */
  value: number;
  by: string | null;
};

/** A recent move of an item to another storage location. */
export type RelocationRow = {
  id: string;
  date: string;
  item: { id: string; name: string; sku: string; unit: string };
  quantity: number;
  from: string | null;
  to: string | null;
  by: string | null;
  note: string | null;
};

export type ProjectMoveResult = { itemName: string; unit: string; quantity: number; fromName: string; toName: string; value: number };
export type RelocationResult = { itemName: string; from: string | null; to: string };

/** An item as the location form needs it. */
export type LocatedItem = { id: string; name: string; sku: string; unit: string; available: number; location: string | null; variant: string | null };
