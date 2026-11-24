import { PageSkeleton } from "@/components/data-table";

export default function Loading() {
  return <PageSkeleton stats={4} table={false} />;
}
