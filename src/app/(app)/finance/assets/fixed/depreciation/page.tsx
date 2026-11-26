import type { Metadata } from "next";
import type { SearchParams } from "@/lib/list-params";
import { DepreciationView } from "@/features/finance/assets/depreciation/components/depreciation-view";

export const metadata: Metadata = { title: "Depreciation on assets" };

export default function FixedAssetDepreciationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <DepreciationView searchParams={searchParams} kind="tangible" />;
}
