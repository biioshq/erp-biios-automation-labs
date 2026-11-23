import type { FinanceKind } from "@/lib/finance-groups";

/** One group of the asset, liability or equity tree, built-in or added by an admin. */
export type GroupOption = {
  key: string;
  label: string;
  parent: string | null;
  kind: FinanceKind;
  builtIn: boolean;
  description: string | null;
  details: string | null;
  archived: boolean;
  /** 0 for a top group. */
  depth: number;
  /** "Non-current assets › Fixed assets › Furniture and fixtures" */
  path: string;
};
