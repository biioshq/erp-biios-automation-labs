import { FIXED_ASSET_ROOT, INTANGIBLE_ROOT } from "@/lib/finance-groups";

/**
 * Words that differ between the fixed asset register and the intangible one. Client-safe.
 * Both use the same records and the same depreciation functions; intangibles say "amortisation"
 * and "carrying value" because that is what an accountant expects to read for software and licences.
 */
export type AssetKind = "tangible" | "intangible";

export type AssetLabels = {
  kind: AssetKind;
  page: string;
  singular: string;
  /** "Depreciation" or "Amortisation". */
  charge: string;
  chargeLower: string;
  accumulated: string;
  value: string;
  href: string;
  /** Group keys records of this kind may be filed under (with their subgroups). */
  roots: string[];
  /** The group "+ Add subgroup" in the header goes under. */
  root: string;
  namePlaceholder: string;
  locationLabel: string;
};

export const ASSET_LABELS: Record<AssetKind, AssetLabels> = {
  tangible: {
    kind: "tangible",
    page: "Fixed assets",
    singular: "fixed asset",
    charge: "Depreciation",
    chargeLower: "depreciation",
    accumulated: "Accumulated depreciation",
    value: "Book value",
    href: "/finance/assets/fixed",
    roots: [FIXED_ASSET_ROOT, "other_long_term_assets", "other_current_assets"],
    root: FIXED_ASSET_ROOT,
    namePlaceholder: "Office chair, laser cutter, delivery van",
    locationLabel: "Location",
  },
  intangible: {
    kind: "intangible",
    page: "Intangible assets",
    singular: "intangible asset",
    charge: "Amortisation",
    chargeLower: "amortisation",
    accumulated: "Accumulated amortisation",
    value: "Carrying value",
    href: "/finance/assets/intangible",
    roots: [INTANGIBLE_ROOT],
    root: INTANGIBLE_ROOT,
    namePlaceholder: "SolidWorks licence, ERP software, trademark",
    locationLabel: "Where it is used",
  },
};

export const labelsFor = (kind: AssetKind | string | null | undefined): AssetLabels =>
  kind === "intangible" ? ASSET_LABELS.intangible : ASSET_LABELS.tangible;
