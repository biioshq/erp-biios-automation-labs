import { Skeleton } from "@/components/ui/skeleton";
import { PreviewSkeleton } from "@/features/reports/components/preview-skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8 lg:py-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {/* Report cards under their group headings. */}
      {[4, 2, 3].map((count, g) => (
        <div key={g} className="space-y-2.5">
          <Skeleton className="h-3 w-32" />
          <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="rounded-xl border bg-card p-5">
        <PreviewSkeleton />
      </div>
    </div>
  );
}
