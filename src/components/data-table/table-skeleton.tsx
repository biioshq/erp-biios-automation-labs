import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder shaped like a DataTable (toolbar, header, rows, pager). */
export function DataTableSkeleton({ columns = 6, rows = 8, filters = 2 }: { columns?: number; rows?: number; filters?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: filters }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
        <Skeleton className="ml-auto h-8 w-20" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" style={{ opacity: 1 - r * 0.07 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loading placeholder for a page: header, KPI row, then a table or panels. */
export function PageSkeleton({ stats = 4, table = true }: { stats?: number; table?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : null}
      {table ? <DataTableSkeleton /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-xl lg:col-span-2" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      )}
    </div>
  );
}
