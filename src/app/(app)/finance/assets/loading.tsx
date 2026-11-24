import { PageSkeleton } from "@/components/data-table";

export default function Loading() {
  return <PageSkeleton stats={6} table={false} />;
}
