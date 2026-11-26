import type { Metadata } from "next";
import type { SearchParams } from "@/lib/list-params";
import { DepreciationView } from "@/features/finance/assets/depreciation/components/depreciation-view";

export const metadata: Metadata = { title: "Amortization" };

export default function IntangibleAmortizationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <DepreciationView searchParams={searchParams} kind="intangible" />;
}
