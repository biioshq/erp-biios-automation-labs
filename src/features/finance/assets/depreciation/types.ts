import type { DepreciationMethod } from "@/lib/constants";
import type { AssetKind } from "@/features/finance/assets/fixed/labels";

/** Figures of a group or of the total, for the selected period. */
export type DepreciationFigures = {
  /** Original purchase value of the assets still held at the end of the period. */
  cost: number;
  /** Depreciation or amortisation charged within the period (also on assets disposed during it). */
  charged: number;
  /** Charged from purchase to the end of the period, on assets still held. */
  accumulated: number;
  /** Cost less accumulated, at the end of the period. */
  bookValue: number;
  count: number;
};

export type DepreciationGroupRow = DepreciationFigures & {
  key: string;
  label: string;
  depth: number;
  kind: AssetKind;
};

export type DepreciationAssetRow = DepreciationFigures & {
  id: string;
  code: string;
  name: string;
  kind: AssetKind;
  groupPath: string;
  purchaseDate: string;
  method: DepreciationMethod;
  usefulLifeYears: number;
  wdvRate: number | null;
  /** Set when it was disposed on or before the end of the period. */
  disposedOn: string | null;
};

export type DepreciationSummary = {
  from: string;
  to: string;
  groups: DepreciationGroupRow[];
  assets: DepreciationAssetRow[];
  totals: DepreciationFigures;
  byKind: Record<AssetKind, DepreciationFigures>;
  /** Financial years that have assets, newest first, for the period picker. */
  years: number[];
};
