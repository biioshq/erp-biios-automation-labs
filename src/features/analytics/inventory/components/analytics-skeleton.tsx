import { Skeleton } from "@/components/ui/skeleton";
import { Page } from "@/components/shared/page";

/** Loading state shared by the inventory and project analytics pages: header, filters, cards, a chart and a table. */
export function AnalyticsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <Page>
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-56 w-full sm:h-64" />
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
        <Skeleton className="h-4 w-48" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </Page>
  );
}
