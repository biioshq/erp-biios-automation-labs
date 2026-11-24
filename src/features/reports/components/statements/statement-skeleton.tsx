import { Skeleton } from "@/components/ui/skeleton";

/** Loading state of a statement page: title, headline cards and the statement body. */
export function StatementSkeleton({ columns = 1 }: { columns?: 1 | 2 }) {
  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8 lg:py-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-8 w-44" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32 max-w-full" />
          </div>
        ))}
      </div>
      <div className={columns === 2 ? "grid gap-5 lg:grid-cols-2" : "grid gap-5"}>
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
            {Array.from({ length: 9 }).map((__, j) => (
              <div key={j} className="flex justify-between gap-4">
                <Skeleton className="h-4 w-48 max-w-[60%]" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
