import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/data-table";

export function PreviewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Building preview">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
      <DataTableSkeleton rows={6} filters={0} />
    </div>
  );
}
